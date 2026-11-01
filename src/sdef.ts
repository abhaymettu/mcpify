import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseXml, type XmlNode } from "./xml.ts";

export interface Property {
  name: string;
  /** Declared type: "text", "date", "integer", another class name, an enumeration name... */
  type: string;
  list: boolean;
  access: "r" | "w" | "rw";
  /** Four-char code; "ID  " marks the identifier property, whatever it is called. */
  code: string;
}

export interface ClassDef {
  name: string;
  plural: string;
  inherits?: string;
  properties: Property[];
  elements: { type: string; access: string }[];
  respondsTo: string[];
}

export interface Param {
  name: string;
  type: string;
  list: boolean;
  optional: boolean;
}

export interface Command {
  name: string;
  suite: string;
  direct?: { type: string; list: boolean; optional: boolean };
  params: Param[];
  result?: string;
}

export interface Dictionary {
  app: string;
  scriptable: boolean;
  suites: string[];
  /** Classes after merging class-extensions and flattening inheritance. */
  classes: Map<string, ClassDef>;
  commands: Command[];
  enums: Map<string, string[]>;
}

/** Read an app's scripting dictionary with `sdef`. Apps without one come back with scriptable: false. */
export function inspectApp(appPath: string): Promise<Dictionary> {
  return new Promise((resolve, reject) => {
    execFile("sdef", [appPath], { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        // sdef exits non-zero for apps with no dictionary.
        if (/no scripting|not scriptable|-192/i.test(stderr + err.message)) return resolve(emptyDictionary(appPath));
        return reject(new Error(stderr.trim() || err.message));
      }
      resolve(parseSdef(stdout, appPath));
    });
  });
}

const emptyDictionary = (app: string): Dictionary => ({ app, scriptable: false, suites: [], classes: new Map(), commands: [], enums: new Map() });

function typeOf(n: XmlNode): { type: string; list: boolean } {
  if (n.attrs.type) return { type: n.attrs.type, list: false };
  const t = n.children.find((c) => c.tag === "type");
  return { type: t?.attrs.type ?? "any", list: t?.attrs.list === "yes" };
}

/** `<xi:include>` pulls in suites from another sdef (usually CocoaStandard), minus commands its xpointer excludes. */
function includedSuites(inc: XmlNode): XmlNode[] {
  const path = (inc.attrs.href ?? "").replace(/^file:\/\/(localhost)?/, "");
  let doc: XmlNode;
  try {
    doc = parseXml(readFileSync(decodeURI(path), "utf8"));
  } catch {
    return [];
  }
  const excluded = new Set([...(inc.attrs.xpointer ?? "").matchAll(/@name = '([^']+)'/g)].map((m) => m[1]));
  const suites = doc.children.find((c) => c.tag === "dictionary")?.children.filter((c) => c.tag === "suite") ?? [];
  return suites.map((s) => ({ ...s, children: s.children.filter((c) => !(c.tag === "command" && excluded.has(c.attrs.name))) }));
}

export function parseSdef(xml: string, app = "?"): Dictionary {
  const dict = parseXml(xml).children.find((c) => c.tag === "dictionary");
  if (!dict) return emptyDictionary(app);
  // An include can stand in for whole suites, or sit inside a suite and splice in the included suites' contents.
  const suites = dict.children
    .flatMap((c) => (c.tag === "suite" ? [c] : c.tag === "xi:include" ? includedSuites(c) : []))
    .map((s) => ({ ...s, children: s.children.flatMap((c) => (c.tag === "xi:include" ? includedSuites(c).flatMap((t) => t.children) : [c])) }));
  const raw = new Map<string, ClassDef>();
  const commands = new Map<string, Command>();
  const enums = new Map<string, string[]>();
  const visible = (n: XmlNode) => n.attrs.hidden !== "yes";

  const merge = (name: string, n: XmlNode, isExtension: boolean) => {
    const c = raw.get(name) ?? { name, plural: `${name}s`, properties: [], elements: [], respondsTo: [] };
    if (!isExtension) {
      if (n.attrs.plural) c.plural = n.attrs.plural;
      if (n.attrs.inherits) c.inherits = n.attrs.inherits;
    }
    for (const ch of n.children.filter(visible)) {
      if (ch.tag === "property" && ch.attrs.name && !c.properties.some((p) => p.name === ch.attrs.name)) {
        c.properties.push({ name: ch.attrs.name, ...typeOf(ch), access: (ch.attrs.access as Property["access"]) ?? "rw", code: ch.attrs.code ?? "" });
      } else if (ch.tag === "element" && ch.attrs.type && !c.elements.some((e) => e.type === ch.attrs.type)) {
        c.elements.push({ type: ch.attrs.type, access: ch.attrs.access ?? "rw" });
      } else if (ch.tag === "responds-to") {
        c.respondsTo.push(ch.attrs.command ?? ch.attrs.name ?? "");
      }
    }
    raw.set(name, c);
  };

  for (const s of suites) {
    for (const n of s.children.filter(visible)) {
      if (n.tag === "class" && n.attrs.name) merge(n.attrs.name, n, false);
      else if (n.tag === "class-extension" && n.attrs.extends) merge(n.attrs.extends, n, true);
      else if (n.tag === "enumeration" && n.attrs.name) enums.set(n.attrs.name, n.children.filter((e) => e.tag === "enumerator").map((e) => e.attrs.name));
      else if (n.tag === "command" && n.attrs.name) {
        const d = n.children.find((c) => c.tag === "direct-parameter");
        const r = n.children.find((c) => c.tag === "result");
        commands.set(n.attrs.name, {
          name: n.attrs.name,
          suite: s.attrs.name ?? "?",
          direct: d && { ...typeOf(d), optional: d.attrs.optional === "yes" },
          params: n.children.filter((c) => c.tag === "parameter" && visible(c)).map((p) => ({ name: p.attrs.name, ...typeOf(p), optional: p.attrs.optional === "yes" })),
          result: r && typeOf(r).type,
        });
      }
    }
  }

  // Flatten inheritance: a class gets its ancestors' properties and elements (its own win).
  const classes = new Map<string, ClassDef>();
  const flat = (name: string, seen = new Set<string>()): ClassDef | undefined => {
    const done = classes.get(name);
    if (done) return done;
    const c = raw.get(name);
    if (!c || seen.has(name)) return c;
    seen.add(name);
    const parent = c.inherits ? flat(c.inherits, seen) : undefined;
    const out: ClassDef = {
      ...c,
      properties: [...c.properties, ...(parent?.properties ?? []).filter((p) => !c.properties.some((q) => q.name === p.name))],
      elements: [...c.elements, ...(parent?.elements ?? []).filter((e) => !c.elements.some((f) => f.type === e.type))],
      respondsTo: [...new Set([...c.respondsTo, ...(parent?.respondsTo ?? [])])],
    };
    classes.set(name, out);
    return out;
  };
  for (const name of raw.keys()) flat(name);

  return { app, scriptable: true, suites: suites.map((s) => s.attrs.name ?? "?"), classes, commands: [...commands.values()], enums };
}
