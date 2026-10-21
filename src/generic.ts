import { z } from "zod";
import type { AppAdapter, AppTool } from "./adapter.ts";
import type { SdefClass, SdefSummary } from "./sdef.ts";

const SCALAR = new Set(["text", "integer", "real", "number", "boolean", "date"]);

/** JXA names: words joined camelCase, first word lower case ("modification date" -> modificationDate, "URL" -> url). */
export const jxaName = (s: string) =>
  s.split(/\s+/).map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1))).join("");
const snake = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/**
 * Build a read-only adapter straight from an app's scripting dictionary, with no hand-written code:
 * for every element class the application object contains, a list tool and a get-by-id tool.
 */
export function adapterFromSdef(appName: string, summary: SdefSummary): AppAdapter {
  const classes = summary.suites.flatMap((s) => s.classes);
  const byName = new Map<string, SdefClass>();
  for (const c of classes) {
    const prev = byName.get(c.name);
    byName.set(c.name, prev ? { ...prev, properties: [...prev.properties, ...c.properties], types: { ...prev.types, ...c.types }, elements: [...prev.elements, ...c.elements], plural: prev.plural ?? c.plural } : c);
  }
  const appClass = classes.filter((c) => c.name === "application" || c.name === "extends application");
  const topLevel = [...new Set(appClass.flatMap((c) => c.elements))].filter((e) => byName.has(e));

  const tools: AppTool[] = [];
  for (const el of topLevel) {
    const cls = byName.get(el)!;
    const plural = jxaName(cls.plural ?? `${el}s`);
    const scalars = cls.properties.filter((p) => SCALAR.has(cls.types[p]));
    const hasId = cls.properties.includes("id"), hasName = cls.properties.includes("name");
    tools.push({
      name: `list_${snake(cls.plural ?? `${el}s`)}`,
      description: `List ${appName} ${cls.plural ?? `${el}s`} (generated from the scripting dictionary). Returns total and up to limit items${hasId ? " with id" : ""}${hasName ? " and name" : ""}.`,
      input: { limit: z.number().int().min(1).max(1000).default(100) },
      writes: false,
      jxa: `(app, args) => {
        const spec = app[${JSON.stringify(plural)}];
        const total = spec.length, limit = args.limit || 100;
        const ids = ${hasId} ? spec.id().slice(0, limit) : [];
        const names = ${hasName} ? spec.name().slice(0, limit) : [];
        const n = Math.min(total, limit), items = [];
        for (let i = 0; i < n; i++) { const it = {}; if (${hasId}) it.id = ids[i]; if (${hasName}) it.name = names[i]; items.push(it); }
        return { total: total, items: items };
      }`,
    });
    if (hasId) {
      tools.push({
        name: `get_${snake(el)}`,
        description: `Read one ${appName} ${el} by id: ${scalars.join(", ")} (generated from the scripting dictionary).`,
        input: { id: z.string() },
        writes: false,
        jxa: `(app, args) => {
          const it = app[${JSON.stringify(plural)}].byId(args.id);
          try { it.id(); } catch (e) { throw new Error("no ${el} with id " + args.id); }
          const out = {}, skipped = [];
          ${JSON.stringify(scalars.map((p) => [p, jxaName(p)]))}.forEach(function (pair) {
            try { out[pair[0]] = it[pair[1]](); } catch (e) { skipped.push(pair[0]); }
          });
          if (skipped.length) out._unreadable = skipped;
          return out;
        }`,
      });
    }
  }
  return { app: appName, server: `mcpify-${snake(appName)}-generated`, tools };
}
