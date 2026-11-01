import { z } from "zod";
import type { AppAdapter, AppTool } from "./adapter.ts";
import { jxaPrelude, parseRef } from "./ref.ts";
import type { ClassDef, Command, Dictionary, Property } from "./sdef.ts";

/** JXA names: words joined camelCase, first word lower case ("modification date" -> modificationDate, "URL" -> url). */
export const jxaName = (s: string) =>
  s.split(/\s+/).map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join("");
/** JXA class constructors: every word capitalised ("smart playlist" -> SmartPlaylist). */
const ctorName = (s: string) => s.split(/\s+/).map((w) => w[0].toUpperCase() + w.slice(1)).join("");
export const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

// "rich text" and "text.ctxt" (the Text Suite class, referenced by id) read and write as plain strings in JXA.
const TEXT = new Set(["text", "string", "Unicode text", "international text", "styled text", "rich text", "text.ctxt"]);
const NUMBER = new Set(["integer", "real", "number", "double integer", "small integer", "small real", "long integer", "extended real"]);
const PATHLIKE = new Set(["file", "alias", "file specification", "file url"]);
/** Properties that can be large; left out of list summaries (still read by get_*). */
const HEAVY = /^(body|plaintext|text|content|contents|html|source|lyrics|data|description|comment|notes|raw source|all headers)$/;
/** Commands generated as write tools only when --allow-delete is given. */
const DESTRUCTIVE = /delete|erase|empty|remove|quit|close|restart|shut ?down|log ?out|sleep|eject|send|move|clear|reset|kill|purge|trash|forward|redirect|reply|bounce/i;
/** Standard Suite commands are covered by create/update/delete tools, or are unsafe for an agent (quit, print). */
const SKIP_COMMANDS = new Set(["open", "close", "save", "print", "quit", "count", "exists", "make", "delete", "duplicate", "move", "activate", "launch", "reopen", "run", "get", "set", "select"]);

export interface GenerateOptions {
  /** Register create/update and command tools (default: read only). */
  writes?: boolean;
  /** Also register delete tools and destructive commands. Needs writes. */
  allowDelete?: boolean;
  /** Deepest containment level to generate tools for (application's own elements are level 1). */
  maxDepth?: number;
}

export interface ClassInfo {
  cls: ClassDef;
  plural: string;
  depth: number;
  parents: string[];
  idProp?: Property;
  hasName: boolean;
}

/** Which classes an agent can reach from the application object by walking elements, and how deep. */
export function reachable(dict: Dictionary, maxDepth = 4): Map<string, ClassInfo> {
  const out = new Map<string, ClassInfo>();
  const app = dict.classes.get("application");
  if (!app) return out;
  let frontier = [app];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: ClassDef[] = [];
    for (const parent of frontier) {
      for (const el of parent.elements) {
        const cls = dict.classes.get(el.type);
        if (!cls || cls.name === "application") continue;
        const seen = out.get(cls.name);
        if (seen) {
          if (!seen.parents.includes(parent.name)) seen.parents.push(parent.name);
          continue;
        }
        out.set(cls.name, {
          cls,
          plural: jxaName(cls.plural),
          depth,
          parents: [parent.name],
          idProp: cls.properties.find((p) => p.code === "ID  ") ?? cls.properties.find((p) => p.name === "id"),
          hasName: cls.properties.some((p) => p.name === "name"),
        });
        next.push(cls);
      }
    }
    frontier = next;
  }
  return out;
}

type Kind = "text" | "number" | "boolean" | "date" | "enum" | "path" | "list" | "ref" | "other";

function kindOf(dict: Dictionary, p: Pick<Property, "type" | "list">): Kind {
  if (p.list) return "list";
  if (TEXT.has(p.type)) return "text";
  if (NUMBER.has(p.type)) return "number";
  if (p.type === "boolean") return "boolean";
  if (p.type === "date") return "date";
  if (dict.enums.has(p.type)) return "enum";
  if (PATHLIKE.has(p.type)) return "path";
  if (dict.classes.has(p.type)) return "ref";
  return "other";
}

/** A zod schema for a value the agent may write into a property or command parameter, or undefined if unsupported. */
function inputSchema(dict: Dictionary, p: Pick<Property, "type" | "list" | "name">): z.ZodType | undefined {
  switch (kindOf(dict, p)) {
    case "text":
    case "path":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "date":
      return z.string().describe("ISO 8601 date-time, e.g. 2026-11-02T09:00:00");
    case "enum": {
      const vals = dict.enums.get(p.type)!;
      return vals.length ? z.enum(vals as [string, ...string[]]) : z.string();
    }
    case "ref":
      return z.string().describe(`ref of a ${p.type}`);
    default:
      return undefined;
  }
}

const describeProps = (dict: Dictionary, props: Property[]) => props.map((p) => `${p.name} (${p.list ? `list of ${p.type}` : p.type})`).join(", ");

/**
 * Build an adapter straight from an app's scripting dictionary, with no hand-written code. For every class
 * reachable from the application object: list_<plural> (with filters and paging) and get_<class> (every
 * property, plus counts of contained elements). With `writes`: create_/update_ per class and the app's own
 * commands. With `allowDelete`: delete_ per class and destructive commands.
 */
export function adapterFromDictionary(appName: string, dict: Dictionary, opts: GenerateOptions = {}): AppAdapter {
  const classes = reachable(dict, opts.maxDepth ?? 4);
  const elements = [...new Set([...classes.values()].map((c) => c.plural))];
  const topLevel: Record<string, string> = {};
  const idProp: Record<string, string> = {};
  for (const [name, c] of classes) {
    // JXA reports classOf() in camelCase ("smartPlaylist").
    if (c.idProp) idProp[jxaName(name)] = jxaName(c.idProp.name);
    if (c.idProp && c.parents.includes("application")) topLevel[jxaName(name)] = c.plural;
  }
  const prelude = jxaPrelude(elements, topLevel, idProp);
  const tools: AppTool[] = [];
  const used = new Set<string>();
  const add = (t: AppTool) => {
    if (used.has(t.name)) return;
    used.add(t.name);
    tools.push(t);
  };
  const readable = (cls: ClassDef) => cls.properties.filter((p) => !["class", "properties"].includes(p.name) && kindOf(dict, p) !== "other");

  const appProps = readable(dict.classes.get("application")!);
  if (appProps.length) {
    const jx = Object.fromEntries(appProps.map((p) => [p.name, jxaName(p.name)]));
    add({
      name: "get_application",
      description: `Read ${appName}'s own properties: ${describeProps(dict, appProps.slice(0, 40))}.`,
      input: { fields: z.array(z.string()).optional() },
      writes: false,
      jxa: `(app, args) => {${prelude}
        const JX = ${JSON.stringify(jx)}, out = {}, unreadable = [];
        const fields = args.fields && args.fields.length ? args.fields.filter(function (f) { return JX[f]; }) : Object.keys(JX);
        for (const f of fields) { try { out[f] = plain(app[JX[f]](), 4000); } catch (e) { unreadable.push(f); } }
        if (unreadable.length) out._unreadable = unreadable;
        return out;
      }`,
    });
  }

  for (const [name, info] of classes) {
    const { cls, plural } = info;
    const props = readable(cls);
    const parentClasses = info.parents.filter((p) => p !== "application");
    const atRoot = info.parents.includes("application");
    const parentHelp = parentClasses.length ? `ref of the containing ${parentClasses.join(" or ")}` : "";
    const scalarKinds = Object.fromEntries(props.map((p) => [p.name, kindOf(dict, p)]));
    const summary = [
      ...(info.idProp ? [info.idProp.name] : []),
      ...(info.hasName ? ["name"] : []),
      // Each field is one Apple Event per list call, so the default summary stays small.
      ...props.filter((p) => !HEAVY.test(p.name) && !/^(creation|modification) date$/.test(p.name) && p.name !== "name" && p !== info.idProp && ["text", "number", "boolean", "date", "enum"].includes(scalarKinds[p.name])).slice(0, 3).map((p) => p.name),
    ];
    const filterable = props.filter((p) => ["text", "number", "boolean", "date", "enum"].includes(scalarKinds[p.name]));
    const jx = Object.fromEntries(props.map((p) => [p.name, jxaName(p.name)]));
    const selector = info.idProp ? `["id", ${JSON.stringify(jxaName(info.idProp.name))}]` : info.hasName ? `["name", "name"]` : `["index", null]`;

    add({
      name: `list_${snake(cls.plural)}`,
      description:
        `List ${appName} ${cls.plural}${parentClasses.length ? (atRoot ? ` (all, or inside one ${parentClasses.join("/")})` : ` inside a ${parentClasses.join("/")}`) : ""}. ` +
        `Each item has a ref for get_${snake(name)}${opts.writes ? " and write tools" : ""}, plus: ${summary.join(", ")}. ` +
        `Filter with where: text properties match by "contains", others by equality, dates and numbers also by {gt, lt}. Filterable: ${filterable.map((p) => p.name).join(", ") || "none"}.`,
      input: {
        ...(parentClasses.length ? { parent: atRoot ? z.string().optional().describe(parentHelp + " (omit for all)") : z.string().describe(parentHelp) } : {}),
        where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.object({ gt: z.union([z.string(), z.number()]).optional(), lt: z.union([z.string(), z.number()]).optional() })])).optional(),
        fields: z.array(z.string()).optional().describe("properties to return instead of the default summary"),
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
      },
      writes: false,
      refArgs: ["parent"],
      elementOf: { plural, parents: info.parents },
      jxa: `(app, args) => {${prelude}
        const KINDS = ${JSON.stringify(scalarKinds)}, JX = ${JSON.stringify(jx)}, SEL = ${selector};
        const base = args.paths.parent || [];
        const coll = base.length ? resolve(base)[${JSON.stringify(plural)}] : app[${JSON.stringify(plural)}];
        const where = args.where || {};
        const keys = Object.keys(where);
        for (const k of keys) if (!KINDS[k] || ["list", "ref", "path"].indexOf(KINDS[k]) >= 0) throw new Error("cannot filter on " + k + "; filterable: " + Object.keys(KINDS).filter(function (p) { return ["text", "number", "boolean", "date", "enum"].indexOf(KINDS[p]) >= 0; }).join(", "));
        const val = (k, v) => KINDS[k] === "date" ? new Date(v) : v;
        let spec = coll, filtered = false;
        if (keys.length) {
          const clauses = keys.map(function (k) {
            const v = where[k], c = {};
            if (v && typeof v === "object") { const parts = []; if (v.gt !== undefined) parts.push({ [JX[k]]: { _greaterThan: val(k, v.gt) } }); if (v.lt !== undefined) parts.push({ [JX[k]]: { _lessThan: val(k, v.lt) } }); return parts.length === 1 ? parts[0] : { _and: parts }; }
            c[JX[k]] = KINDS[k] === "text" ? { _contains: v } : val(k, v);
            return c;
          });
          try { spec = coll.whose(clauses.length === 1 ? clauses[0] : { _and: clauses }); spec.length; filtered = true; } catch (e) { spec = null; }
        }
        const fields = (args.fields && args.fields.length ? args.fields : ${JSON.stringify(summary)}).filter(function (f) { return JX[f]; });
        const need = fields.slice();
        if (SEL[1] && need.indexOf(SEL[0] === "id" ? ${JSON.stringify(info.idProp?.name ?? "")} : "name") < 0) need.push(SEL[0] === "id" ? ${JSON.stringify(info.idProp?.name ?? "")} : "name");
        if (${info.hasName} && need.indexOf("name") < 0) need.push("name");
        if (!spec) for (const k of keys) if (need.indexOf(k) < 0) need.push(k);
        const src = spec || coll, cols = {}, unreadable = [];
        const total = src.length;
        for (const f of need) { try { cols[f] = src[JX[f]](); } catch (e) { cols[f] = null; unreadable.push(f); } }
        let idx = []; for (let i = 0; i < total; i++) idx.push(i);
        if (!spec && keys.length) {
          idx = idx.filter(function (i) { return keys.every(function (k) {
            const have = cols[k] && cols[k][i], want = where[k];
            if (want && typeof want === "object") { const h = KINDS[k] === "date" ? +have : have; return (want.gt === undefined || h > +val(k, want.gt)) && (want.lt === undefined || h < +val(k, want.lt)); }
            if (KINDS[k] === "text") return String(have || "").toLowerCase().indexOf(String(want).toLowerCase()) >= 0;
            return KINDS[k] === "date" ? +have === +val(k, want) : have === want;
          }); });
        }
        const page = idx.slice(args.offset || 0, (args.offset || 0) + (args.limit || 50));
        const items = page.map(function (i) {
          const it = {};
          const keyProp = SEL[0] === "id" ? ${JSON.stringify(info.idProp?.name ?? "")} : "name";
          if (SEL[0] === "index") { if (!filtered && !keys.length) it.ref = refOf(base.concat([[${JSON.stringify(plural)}, "index", i]])); }
          else if (cols[keyProp] && cols[keyProp][i] !== undefined && cols[keyProp][i] !== null) it.ref = refOf(base.concat([[${JSON.stringify(plural)}, SEL[0], cols[keyProp][i]]]));
          // Some identifiers cannot be read in bulk (Calendar's calendarIdentifier); select by name instead.
          else if (cols.name && cols.name[i] !== undefined && cols.name[i] !== null) it.ref = refOf(base.concat([[${JSON.stringify(plural)}, "name", cols.name[i]]]));
          for (const f of fields) it[f] = cols[f] ? plain(cols[f][i], 200) : null;
          return it;
        });
        const out = { total: keys.length ? idx.length : total, offset: args.offset || 0, items: items };
        if (unreadable.length) out.unreadable = unreadable;
        return out;
      }`,
    });

    add({
      name: `get_${snake(name)}`,
      description: `Read one ${appName} ${name} by ref: ${describeProps(dict, props.slice(0, 40))}${props.length > 40 ? ", ..." : ""}. Also counts what it contains${cls.elements.length ? ` (${cls.elements.map((e) => e.type).join(", ")})` : ""}.`,
      input: { ref: z.string().describe(`ref of a ${name}, from list_${snake(cls.plural)}`), fields: z.array(z.string()).optional() },
      writes: false,
      refArgs: ["ref"],
      refClass: name,
      jxa: `(app, args) => {${prelude}
        const JX = ${JSON.stringify(jx)}, ELS = ${JSON.stringify(cls.elements.map((e) => classes.get(e.type)?.plural).filter(Boolean))};
        const it = resolve(args.paths.ref);
        try { it.properties(); } catch (e) { try { it.name(); } catch (e2) { throw new Error("no ${name} at " + args.ref); } }
        const out = { ref: args.ref }, unreadable = [];
        const fields = args.fields && args.fields.length ? args.fields.filter(function (f) { return JX[f]; }) : Object.keys(JX);
        let all = null;
        try { all = it.properties(); } catch (e) {}
        for (const f of fields) {
          if (all && Object.prototype.hasOwnProperty.call(all, JX[f])) { out[f] = plain(all[JX[f]], 4000); continue; }
          try { out[f] = plain(it[JX[f]](), 4000); } catch (e) { unreadable.push(f); }
        }
        if (!args.fields || !args.fields.length) {
          const counts = {};
          for (const el of ELS) { try { counts[el] = it[el].length; } catch (e) {} }
          if (Object.keys(counts).length) out._contains = counts;
        }
        if (unreadable.length) out._unreadable = unreadable;
        return out;
      }`,
    });

    if (!opts.writes) continue;
    const writable = props.filter((p) => p.access !== "r" && p !== info.idProp && inputSchema(dict, p));
    const propShape = Object.fromEntries(writable.map((p) => [p.name, inputSchema(dict, p)!.optional()]));
    const coerce = `const KINDS = ${JSON.stringify(Object.fromEntries(writable.map((p) => [p.name, kindOf(dict, p)])))}, JX = ${JSON.stringify(Object.fromEntries(writable.map((p) => [p.name, jxaName(p.name)])))};
        function value(k, v) { if (KINDS[k] === "date") { const d = new Date(v); if (isNaN(d)) throw new Error(k + ": not a date: " + v); return d; } if (KINDS[k] === "ref") return resolve(args.paths["properties." + k]); if (KINDS[k] === "path") return Path(v); return v; }
        function props(p) { const o = {}; for (const k of Object.keys(p || {})) { if (!JX[k]) throw new Error("not writable: " + k + "; writable: " + Object.keys(JX).join(", ")); o[JX[k]] = value(k, p[k]); } return o; }`;
    const refProps = writable.filter((p) => kindOf(dict, p) === "ref").map((p) => `properties.${p.name}`);
    const containers = info.parents.filter((p) => (dict.classes.get(p)?.elements.find((e) => e.type === name)?.access ?? "rw") !== "r");
    // Windows come and go with documents; making or deleting one by script does nothing useful.
    const makeable = dict.commands.some((c) => c.name === "make") && containers.length > 0 && !/window$/.test(name);
    const keyRead = info.idProp ? `[${JSON.stringify(plural)}, "id", o[${JSON.stringify(jxaName(info.idProp.name))}]()]` : info.hasName ? `[${JSON.stringify(plural)}, "name", o.name()]` : "null";

    if (makeable && writable.length) {
      const nested = containers.filter((p) => p !== "application");
      add({
        name: `create_${snake(name)}`,
        description: `Create a ${appName} ${name}${nested.length ? ` inside a ${nested.join("/")}` : ""}. Writable properties: ${describeProps(dict, writable)}.`,
        input: {
          ...(nested.length ? { parent: containers.includes("application") ? z.string().optional().describe(`ref of the containing ${nested.join(" or ")} (omit for the app's default place)`) : z.string().describe(`ref of the containing ${nested.join(" or ")}`) } : {}),
          properties: z.strictObject(propShape).describe("initial property values"),
        },
        writes: true,
        refArgs: ["parent", ...refProps],
        elementOf: { plural, parents: containers },
        jxa: `(app, args) => {${prelude}
        ${coerce}
        const base = args.paths.parent || [];
        const coll = base.length ? resolve(base)[${JSON.stringify(plural)}] : app[${JSON.stringify(plural)}];
        const p = props(args.properties);
        let o = app[${JSON.stringify(ctorName(name))}](p);
        // Some apps (Finder, Music) refuse push-style creation; fall back to the make command.
        try { coll.push(o); } catch (e) { o = app.make({ new: ${JSON.stringify(jxaName(name))}, at: base.length ? resolve(base) : undefined, withProperties: p }); }
        // Some apps (TextEdit) make the object but drop properties given at creation; set those again.
        for (const k of Object.keys(p)) { try { const v = o[k](); if (String(v) !== String(p[k]) && !(v instanceof Date)) o[k] = p[k]; } catch (e) {} }
        const seg = ${keyRead};
        return { created: true, ref: seg ? refOf(base.concat([seg])) : null };
      }`,
        preview: `(app, args) => {${prelude}
        const base = args.paths.parent || [];
        return { action: "create ${name}", in: base.length ? plain(resolve(base), 200) : ${JSON.stringify(appName)}, properties: args.properties };
      }`,
      });
    }
    if (info.idProp || info.hasName) {
      if (writable.length) {
        add({
          name: `update_${snake(name)}`,
          description: `Change properties of a ${appName} ${name}. Writable: ${describeProps(dict, writable)}.`,
          input: { ref: z.string().describe(`ref of a ${name}`), properties: z.strictObject(propShape).describe("properties to set") },
          writes: true,
          refArgs: ["ref", ...refProps],
          refClass: name,
          jxa: `(app, args) => {${prelude}
        ${coerce}
        const o = resolve(args.paths.ref);
        const p = props(args.properties), keys = Object.keys(p);
        // Apps validate after each assignment (Calendar rejects a start after the end), so if one order fails try the other.
        try { for (const k of keys) o[k] = p[k]; } catch (e) { for (const k of keys.slice().reverse()) o[k] = p[k]; }
        const after = {};
        for (const k of Object.keys(args.properties || {})) { try { after[k] = plain(o[JX[k]](), 500); } catch (e) {} }
        return { updated: true, ref: args.ref, now: after };
      }`,
          preview: `(app, args) => {${prelude}
        ${coerce}
        const o = resolve(args.paths.ref), before = {};
        for (const k of Object.keys(args.properties || {})) { if (!JX[k]) throw new Error("not writable: " + k); try { before[k] = plain(o[JX[k]](), 500); } catch (e) { before[k] = null; } }
        let label = null; try { label = o.name(); } catch (e) {}
        return { action: "update ${name}", target: args.ref, name: label, before: before, after: args.properties };
      }`,
        });
      }
      if (opts.allowDelete && containers.length && !/window$/.test(name)) {
        add({
          name: `delete_${snake(name)}`,
          description: `Delete a ${appName} ${name}. Destructive.`,
          input: { ref: z.string().describe(`ref of a ${name}`) },
          writes: true,
          destructive: true,
          refArgs: ["ref"],
          refClass: name,
          jxa: `(app, args) => {${prelude}
        app.delete(resolve(args.paths.ref));
        return { deleted: true, ref: args.ref };
      }`,
          preview: `(app, args) => {${prelude}
        const o = resolve(args.paths.ref);
        let label = null; try { label = o.name(); } catch (e) {}
        try { o.properties(); } catch (e) { if (label === null) throw new Error("nothing at " + args.ref); }
        return { action: "delete ${name}", target: args.ref, name: label };
      }`,
        });
      }
    }
  }

  if (opts.writes) for (const cmd of dict.commands) addCommand(dict, appName, cmd, classes, prelude, opts, add);
  const byPlural = new Map([...classes].map(([n, c]) => [c.plural, n]));
  const checkRef = (ref: string) => {
    const path = parseRef(ref);
    let at = "application";
    for (const [el] of path) {
      const cls = byPlural.get(el);
      if (!cls) throw new Error(`unknown element "${el}" in ref; known: ${[...byPlural.keys()].join(", ")}`);
      if (!classes.get(cls)!.parents.includes(at) && !(at !== "application" && dict.classes.get(at)?.elements.some((e) => e.type === cls)))
        throw new Error(`a ${at} has no ${el} (ref ${ref})`);
      at = cls;
    }
    return { path, cls: at };
  };
  const idByPlural = Object.fromEntries([...classes.values()].filter((c) => c.idProp).map((c) => [c.plural, jxaName(c.idProp!.name)]));
  // Rewrites each step of a ref to select by id where the class has one, so refs by name and by id compare equal.
  const canonJxa = `(app, args) => {${prelude}
    const IDS = ${JSON.stringify(idByPlural)};
    const out = [];
    for (let i = 0; i < args.path.length; i++) {
      const seg = args.path[i], o = resolve(args.path.slice(0, i + 1));
      if (IDS[seg[0]]) { try { out.push([seg[0], "id", o[IDS[seg[0]]]()]); continue; } catch (e) {} }
      out.push(seg);
    }
    return refOf(out);
  }`;
  return { app: appName, server: `mcpify-${snake(appName)}`, tools, checkRef, canonJxa };
}

function addCommand(
  dict: Dictionary,
  appName: string,
  cmd: Command,
  classes: Map<string, ClassInfo>,
  prelude: string,
  opts: GenerateOptions,
  add: (t: AppTool) => void,
) {
  if (SKIP_COMMANDS.has(cmd.name) || /standard|text suite|type definitions/i.test(cmd.suite)) return;
  const destructive = DESTRUCTIVE.test(cmd.name);
  if (destructive && !opts.allowDelete) return;
  const objectTypes = new Set(["specifier", "any", "item", "reference", "location specifier", ...classes.keys()]);
  const input: Record<string, z.ZodType> = {};
  const refArgs: string[] = [];
  let direct = "undefined";
  if (cmd.direct) {
    if (objectTypes.has(cmd.direct.type) || cmd.direct.list) {
      if (!objectTypes.has(cmd.direct.type)) return;
      input.target = cmd.direct.optional ? z.string().optional().describe("ref of the object to act on") : z.string().describe("ref of the object to act on");
      refArgs.push("target");
      direct = `args.paths.target ? resolve(args.paths.target) : undefined`;
    } else {
      const s = inputSchema(dict, { ...cmd.direct, name: "value" });
      if (!s) return;
      input.value = cmd.direct.optional ? s.optional() : s;
      direct = cmd.direct.type === "date" ? "args.value === undefined ? undefined : new Date(args.value)" : PATHLIKE.has(cmd.direct.type) ? "args.value === undefined ? undefined : Path(args.value)" : "args.value";
    }
  }
  const params: [string, string, string][] = [];
  for (const p of cmd.params) {
    const isObj = objectTypes.has(p.type) && !TEXT.has(p.type);
    const s = isObj ? z.string().describe("ref") : inputSchema(dict, p);
    if (!s) {
      if (p.optional) continue;
      return;
    }
    const key = snake(p.name);
    input[key] = p.optional ? s.optional() : s;
    if (isObj) refArgs.push(key);
    params.push([key, jxaName(p.name), isObj ? "ref" : kindOf(dict, p)]);
  }
  add({
    name: snake(cmd.name),
    description: `${appName} command "${cmd.name}" from its scripting dictionary.${destructive ? " Destructive." : ""}`,
    input,
    writes: true,
    destructive,
    refArgs,
    jxa: `(app, args) => {${prelude}
        const opt = {};
        for (const [k, jx, kind] of ${JSON.stringify(params)}) { if (args[k] === undefined) continue; opt[jx] = kind === "ref" ? resolve(args.paths[k]) : kind === "date" ? new Date(args[k]) : args[k]; }
        const d = ${direct};
        const r = Object.keys(opt).length ? (d === undefined ? app[${JSON.stringify(jxaName(cmd.name))}](opt) : app[${JSON.stringify(jxaName(cmd.name))}](d, opt)) : (d === undefined ? app[${JSON.stringify(jxaName(cmd.name))}]() : app[${JSON.stringify(jxaName(cmd.name))}](d));
        return { done: true, result: plain(r, 2000) };
      }`,
    preview: `(app, args) => {${prelude}
        const d = args.paths.target ? plain(resolve(args.paths.target), 200) : null;
        const a = {}; for (const k of Object.keys(args)) if (k !== "paths" && k !== "confirm") a[k] = args[k];
        return { action: ${JSON.stringify(`${cmd.name}`)}, target: d, arguments: a };
      }`,
  });
}
