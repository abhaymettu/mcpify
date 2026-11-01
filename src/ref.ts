/**
 * Object references. Every object a generated tool returns carries a `ref`, a path from the application
 * object, such as `calendars[name="Work"]/events[id="1F2E..."]`. Tools take refs back as arguments.
 * A ref is parsed here into data and walked inside osascript by `resolve` below; it is never spliced into
 * the script, and each step must name an element the dictionary declares.
 */
export type Selector = "id" | "name" | "index";
export type RefPath = [element: string, by: Selector, value: string | number][];

const SEG = /^([A-Za-z][A-Za-z0-9]*)\[(id|name|index)=("(?:[^"\\]|\\.)*"|\d+)\]/;

export function parseRef(ref: string): RefPath {
  const path: RefPath = [];
  let rest = ref.trim();
  while (rest) {
    const m = rest.match(SEG);
    if (!m) throw new Error(`not a ref: ${JSON.stringify(ref)} (expected e.g. lists[id="..."]/reminders[name="..."])`);
    path.push([m[1], m[2] as Selector, m[2] === "index" ? Number(m[3]) : JSON.parse(m[3])]);
    rest = rest.slice(m[0].length);
    if (rest && !rest.startsWith("/")) throw new Error(`not a ref: ${JSON.stringify(ref)}`);
    rest = rest.slice(1);
  }
  if (!path.length) throw new Error("empty ref");
  return path;
}

export const formatRef = (path: RefPath) => path.map(([e, by, v]) => `${e}[${by}=${JSON.stringify(v)}]`).join("/");

/**
 * JXA helpers shared by every generated tool: `resolve` walks a parsed ref, `plain` turns any Apple Event
 * value into JSON (dates to ISO strings, object specifiers to a small summary with a ref when one can be
 * built, file paths to strings, long text cut to `maxText`).
 */
export function jxaPrelude(elements: string[], topLevel: Record<string, string>, idProp: Record<string, string>): string {
  return `
  const ELEMENTS = ${JSON.stringify(elements)};
  const TOP = ${JSON.stringify(topLevel)};
  const IDP = ${JSON.stringify(idProp)};
  function resolve(path) {
    let s = app;
    for (const seg of path) {
      if (ELEMENTS.indexOf(seg[0]) < 0) throw new Error("unknown element " + seg[0]);
      const c = s[seg[0]];
      s = seg[1] === "id" ? c.byId(seg[2]) : seg[1] === "name" ? c.byName(seg[2]) : c.at(seg[2]);
    }
    return s;
  }
  function refOf(path) { return path.map(function (p) { return p[0] + "[" + p[1] + "=" + JSON.stringify(p[2]) + "]"; }).join("/"); }
  function plain(v, maxText, depth) {
    depth = depth || 0;
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
    if (Array.isArray(v)) return v.slice(0, 200).map(function (x) { return plain(x, maxText, depth + 1); });
    if (typeof v === "string") return v.length > maxText ? v.slice(0, maxText) + " [cut, " + v.length + " chars]" : v;
    if (typeof v === "number" || typeof v === "boolean") return v;
    if (ObjectSpecifier.hasInstance(v)) {
      if (depth > 1) return null;
      const o = {};
      try { o.class = ObjectSpecifier.classOf(v); } catch (e) {}
      try { o.name = v.name(); } catch (e) {}
      const idp = IDP[o.class];
      if (idp) { try { o.id = v[idp](); } catch (e) {} }
      if (o.id !== undefined && TOP[o.class]) o.ref = refOf([[TOP[o.class], "id", o.id]]);
      return o;
    }
    try { const s = v.toString(); if (s && s !== "[object Object]") return s; } catch (e) {}
    if (typeof v === "object") { const o = {}; for (const k in v) o[k] = plain(v[k], maxText, depth + 1); return o; }
    return String(v);
  }`;
}
