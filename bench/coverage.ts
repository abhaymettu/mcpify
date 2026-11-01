// Live coverage: for each app, generate its server, call every read tool the sweep can reach against the
// real app, and run a create/update/delete round trip inside a test container, checked with raw osascript.
// Records only pass/fail and error kinds, never the values the app returned.
//
//   node bench/coverage.ts [App ...]      default: every app in bench/fixtures.ts
//   writes bench/results/coverage.json and bench/results/coverage.md
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { findApp } from "../src/find.ts";
import { inspectApp } from "../src/sdef.ts";
import { adapterFromDictionary, reachable, snake } from "../src/generate.ts";
import { FIXTURES, type Fixture } from "./fixtures.ts";

const CALL_TIMEOUT_MS = 120_000;
const [osaCmd, ...osaPre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);

function osa<T>(app: string, fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application(${JSON.stringify(app)});const args=JSON.parse(argv[0]);const r=(${fn})(app,args.n);return JSON.stringify(r===undefined?null:r);}`;
  return JSON.parse(execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8", timeout: 240_000 }));
}

// Error text can quote app data ("Can't get note \"Groceries\""); keep its shape only.
const scrub = (s: string) => s.replace(/"[^"]*"/g, '"…"').replace(/\s+/g, " ").slice(0, 160);

type Status = "pass" | "fail" | "untested";
interface ToolResult {
  tool: string;
  kind: "read" | "write" | "destructive";
  status: Status;
  ms?: number;
  error?: string;
}

interface AppResult {
  app: string;
  scriptable: boolean;
  classes: number;
  tools: { read: number; write: number; destructive: number };
  results: ToolResult[];
  note?: string;
}

async function covers(fx: Fixture): Promise<AppResult> {
  const path = findApp(fx.app);
  const dict = await inspectApp(path);
  const name = path.split("/").pop()!.replace(/\.app$/, "");
  const full = adapterFromDictionary(name, dict, { writes: true, allowDelete: true });
  const classes = reachable(dict);
  const out: AppResult = {
    app: fx.app,
    scriptable: dict.scriptable,
    classes: classes.size,
    tools: {
      read: full.tools.filter((t) => !t.writes).length,
      write: full.tools.filter((t) => t.writes && !t.destructive).length,
      destructive: full.tools.filter((t) => t.destructive).length,
    },
    results: [],
    note: fx.why,
  };
  const byTool = new Map<string, ToolResult>(full.tools.map((t) => [t.name, { tool: t.name, kind: t.destructive ? "destructive" : t.writes ? "write" : "read", status: "untested" }]));
  out.results = [...byTool.values()];
  const made = fx.setup ? osa<unknown>(name, fx.setup) : null;
  if (typeof made === "string") {
    const fill = (r: string) => r.replace("{doc}", made);
    fx = { ...fx, scope: fx.scope?.map(fill), roundTrip: fx.roundTrip && { ...fx.roundTrip, parent: fx.roundTrip.parent && fill(fx.roundTrip.parent) } };
  }

  const args = [name, "--writes", "--allow-delete", "--confirm", "none", ...(fx.scope ?? []).flatMap((s) => ["--scope", s])];
  const client = new Client({ name: "mcpify-coverage", version: "0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", ...args], env: { ...process.env, MCPIFY_TIMEOUT_MS: String(CALL_TIMEOUT_MS) } as Record<string, string> }));
  const call = async (tool: string, a: Record<string, unknown>) => {
    const t0 = Date.now();
    try {
      const res = await client.callTool({ name: tool, arguments: a }, undefined, { timeout: CALL_TIMEOUT_MS + 15_000 });
      const text = (res.content as { text: string }[])[0]?.text ?? "";
      return { ok: !res.isError, ms: Date.now() - t0, data: res.isError ? undefined : (res.structuredContent as { result: any }).result, error: res.isError ? text : undefined };
    } catch (e) {
      return { ok: false, ms: Date.now() - t0, data: undefined, error: (e as Error).message };
    }
  };
  const record = (tool: string, r: { ok: boolean; ms: number; error?: string }) => {
    const t = byTool.get(tool);
    if (!t || t.status === "pass") return;
    t.status = r.ok ? "pass" : "fail";
    t.ms = r.ms;
    t.error = r.ok ? undefined : scrub(r.error ?? "");
  };

  try {
    // Read sweep. Start from the app object and the test containers; for each class reached, call its
    // list_ tool, then get_ on the first item, then the list_ tools of what that item contains.
    if (byTool.has("get_application")) record("get_application", await call("get_application", { fields: ["name", "version"] }));
    const plural2class = new Map([...classes].map(([n, c]) => [snake(c.cls.plural), n]));
    const queue: { cls: string; ref?: string }[] = [];
    const visited = new Set<string>();
    for (const s of [...(fx.scope ?? []), ...(fx.sweep ?? [])]) {
      const ref = full.checkRef!(s);
      queue.push({ cls: ref.cls, ref: s });
    }
    if (!fx.sensitive || !(fx.scope ?? fx.sweep)) queue.unshift({ cls: "application" });
    else queue.push({ cls: "application" });
    let budget = 60;
    while (queue.length && budget-- > 0) {
      const { cls, ref } = queue.shift()!;
      const key = `${cls}|${ref ?? ""}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (ref) record(`get_${snake(cls)}`, await call(`get_${snake(cls)}`, { ref }));
      const children = cls === "application" ? [...classes.values()].filter((c) => c.parents.includes("application")) : [...classes.values()].filter((c) => c.parents.includes(cls));
      for (const child of children) {
        const tool = `list_${snake(child.cls.plural)}`;
        if (!byTool.has(tool) || (byTool.get(tool)!.status === "pass" && visited.has(`${child.cls.name}|*`))) continue;
        const a: Record<string, unknown> = { limit: 2 };
        if (ref) a.parent = ref;
        // In personal-data apps, top-level lists only ever return objects named like the test data.
        if (fx.sensitive && !ref) {
          if (!child.hasName) a.fields = child.idProp ? [child.idProp.name] : [];
          else a.where = { name: "mcpify-test" };
        }
        const r = await call(tool, a);
        record(tool, r);
        if (!r.ok) continue;
        visited.add(`${child.cls.name}|*`);
        const first = r.data?.items?.find((i: any) => i.ref);
        // Personal-data apps: descend only below the test containers.
        if (first && (!fx.sensitive || ref || (child.hasName && a.where))) queue.push({ cls: plural2class.get(snake(child.cls.plural))!, ref: first.ref });
      }
    }

    // Write round trip inside the test container, each step checked with raw osascript.
    const rt = fx.roundTrip;
    if (rt) {
      const nm = `mcpifycov${Date.now().toString(36)}`;
      const sub = (v: unknown): unknown => (typeof v === "string" ? v.replace(/NAME/g, nm) : v);
      const props = Object.fromEntries(Object.entries(rt.create).map(([k, v]) => [k, sub(v)]));
      const count = () => osa<number>(name, `(app, n) => (${rt.find})(app, n).length`, { n: nm });
      const before = count();
      const c = await call(`create_${snake(rt.cls)}`, { ...(rt.parent ? { parent: rt.parent } : {}), properties: props });
      const created = c.ok && count() === before + 1;
      record(`create_${snake(rt.cls)}`, { ...c, ok: created, error: c.error ?? (c.ok ? "created, but raw osascript did not find it" : undefined) });
      const ref = c.data?.ref;
      if (created && ref) {
        record(`get_${snake(rt.cls)}`, await call(`get_${snake(rt.cls)}`, { ref }));
        const [prop, value, jx] = rt.update;
        const u = await call(`update_${snake(rt.cls)}`, { ref, properties: { [prop]: sub(value) } });
        const now = u.ok ? osa<unknown>(name, `(app, n) => { const all = (${rt.find})(app, n); const o = all[all.length - 1]; return o ? o.${jx}() : null; }`, { n: nm }) : undefined;
        record(`update_${snake(rt.cls)}`, { ...u, ok: u.ok && now === sub(value), error: u.error ?? (u.ok ? "updated, but raw osascript read a different value" : undefined) });
        const d = await call(`delete_${snake(rt.cls)}`, { ref });
        const gone = d.ok && count() === before;
        record(`delete_${snake(rt.cls)}`, { ...d, ok: gone, error: d.error ?? (d.ok ? "deleted, but raw osascript still finds it" : undefined) });
      }
      // Clean up anything a failed step left behind.
      try {
        osa(name, `(app, n) => { (${rt.find})(app, n).forEach(function (o) { try { if (o.close) { try { o.close({ saving: "no" }); return; } catch (e) {} } app.delete(o); } catch (e) {} }); }`, { n: nm });
      } catch {}
    }
  } finally {
    await client.close();
    if (fx.teardown) {
      try {
        if (typeof fx.teardown === "function") fx.teardown();
        else osa(name, fx.teardown);
      } catch {}
    }
  }
  return out;
}

const only = process.argv.slice(2);
const fixtures = only.length ? only.map((a) => FIXTURES.find((f) => f.app.toLowerCase() === a.toLowerCase()) ?? { app: a }) : FIXTURES;
const all: AppResult[] = [];
for (const fx of fixtures) {
  process.stderr.write(`${fx.app} ... `);
  try {
    const r = await covers(fx);
    all.push(r);
    const n = (k: ToolResult["kind"], s: Status) => r.results.filter((x) => (k === "read" ? x.kind === "read" : x.kind !== "read") && x.status === s).length;
    process.stderr.write(`read ${n("read", "pass")}/${r.tools.read} pass, ${n("read", "fail")} fail; writes ${n("write", "pass")} pass, ${n("write", "fail")} fail\n`);
  } catch (e) {
    process.stderr.write(`error: ${scrub((e as Error).message)}\n`);
    all.push({ app: fx.app, scriptable: false, classes: 0, tools: { read: 0, write: 0, destructive: 0 }, results: [], note: scrub((e as Error).message) });
  }
}

mkdirSync("bench/results", { recursive: true });
const stamp = new Date().toISOString();
// A partial run replaces those apps in the existing report and keeps the rest (each app records its own run time).
for (const r of all) (r as AppResult & { when?: string }).when = stamp;
try {
  const prev: AppResult[] = JSON.parse(readFileSync("bench/results/coverage.json", "utf8")).apps;
  const fresh = new Set(all.map((r) => r.app));
  all.unshift(...prev.filter((r) => !fresh.has(r.app)));
  all.sort((a, b) => fixtures.concat(FIXTURES).findIndex((f) => f.app === a.app) - fixtures.concat(FIXTURES).findIndex((f) => f.app === b.app));
} catch {}
writeFileSync("bench/results/coverage.json", JSON.stringify({ when: stamp, macos: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(), apps: all }, null, 2));
const rows = all.map((r) => {
  const read = r.results.filter((x) => x.kind === "read");
  const writes = r.results.filter((x) => x.kind !== "read");
  const c = (xs: ToolResult[], s: Status) => xs.filter((x) => x.status === s).length;
  const reasons = [...new Set(r.results.filter((x) => x.status === "fail").map((x) => `${x.tool}: ${x.error}`))].slice(0, 3).join("; ");
  return `| ${r.app} | ${r.classes} | ${r.tools.read} / ${r.tools.write + r.tools.destructive} | ${c(read, "pass")} | ${c(read, "fail")} | ${c(read, "untested")} | ${c(writes, "pass")} of ${c(writes, "pass") + c(writes, "fail")} | ${[reasons, r.note].filter(Boolean).join("; ") || ""} |`;
});
const totals = (k: "read" | "w", s: Status) => all.flatMap((r) => r.results).filter((x) => (k === "read" ? x.kind === "read" : x.kind !== "read") && x.status === s).length;
writeFileSync(
  "bench/results/coverage.md",
  `Coverage report, last updated ${stamp} (per-app run times in coverage.json). Generated with \`--writes --allow-delete\` so every tool is counted; the default server is read only.\n\n` +
    `| App | Classes | Tools (read / write) | Read pass | Read fail | Read not reached | Write round trip | Failures and notes |\n|---|---|---|---|---|---|---|---|\n${rows.join("\n")}\n` +
    `| **All** | ${all.reduce((a, r) => a + r.classes, 0)} | ${all.reduce((a, r) => a + r.tools.read, 0)} / ${all.reduce((a, r) => a + r.tools.write + r.tools.destructive, 0)} | ${totals("read", "pass")} | ${totals("read", "fail")} | ${totals("read", "untested")} | ${totals("w", "pass")} of ${totals("w", "pass") + totals("w", "fail")} | |\n`,
);
console.log(`wrote bench/results/coverage.md`);
