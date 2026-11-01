// Agent suite: Claude Code does each task in bench/tasks.ts twice, once with the generated mcpify server
// and once with only a Bash tool limited to `osascript` (raw AppleScript/JXA, the usual way agents drive
// Mac apps today). Same model, prompt, turn limit and grader for both arms.
//
//   node bench/agent.ts [--arms mcpify,osascript] [--reps 1] [--model sonnet] [--only id,id] [--apps A,B]
//   writes bench/results/agent-<stamp>.jsonl (one line per run) and bench/results/agent.md (summary)
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CLEANUP, FINGERPRINT, TASKS, type Task } from "./tasks.ts";

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const ARMS = opt("arms", "mcpify,osascript").split(",");
const REPS = Number(opt("reps", "1"));
const MODEL = opt("model", "sonnet");
const ONLY = opt("only", "").split(",").filter(Boolean);
const APPS = opt("apps", "").split(",").filter(Boolean);
const MAX_TURNS = 25;
const RUN_TIMEOUT_MS = 480_000;
const ROOT = resolve(import.meta.dirname, "..");

// Both arms reach the apps through the same osascript: MCPIFY_OSASCRIPT if set (a wrapper holding the
// macOS Automation grants), exposed to the Bash arm as `osascript` on PATH.
const shimDir = mkdtempSync(join(tmpdir(), "mcpify-bench-"));
if (process.env.MCPIFY_OSASCRIPT) {
  writeFileSync(join(shimDir, "osascript"), `#!/bin/sh\nexec ${process.env.MCPIFY_OSASCRIPT} "$@"\n`, { mode: 0o755 });
}

const SYSTEM = `You are operating apps on a Mac for the user. Do exactly what the request asks, only on the items it names, then reply with a short final answer. Never touch other data.`;
// Keep the user's own CLAUDE.md, memory, hooks and plugins out of the runs.
const SETTINGS = JSON.stringify({ claudeMdExcludes: ["/Users/**/CLAUDE.md", "/Users/**/.claude/**"], autoMemoryEnabled: false });

function armArgs(task: Task, arm: string, cfgDir: string): string[] {
  if (arm === "mcpify") {
    const flags = [task.app, ...(task.needs !== "read" ? ["--writes"] : []), ...(task.needs === "delete" ? ["--allow-delete"] : []), "--confirm", "token", ...(task.scope ?? []).flatMap((s) => ["--scope", s])];
    const cfg = join(cfgDir, "mcp.json");
    writeFileSync(cfg, JSON.stringify({ mcpServers: { app: { command: process.execPath, args: [join(ROOT, "src/cli.ts"), ...flags], env: process.env.MCPIFY_OSASCRIPT ? { MCPIFY_OSASCRIPT: process.env.MCPIFY_OSASCRIPT } : {} } } }));
    return ["--strict-mcp-config", "--mcp-config", cfg, "--tools", "", "--allowedTools", "mcp__app"];
  }
  return ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", "Bash", "--allowedTools", "Bash(osascript:*)"];
}

interface Run {
  task: string;
  app: string;
  arm: string;
  rep: number;
  ok: boolean;
  collateral: boolean;
  turns?: number;
  toolCalls: number;
  toolErrors: number;
  ms: number;
  costUsd?: number;
  answer: string;
  error?: string;
}

function runClaude(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<{ lines: any[]; ms: number; error?: string }> {
  return new Promise((done) => {
    const t0 = Date.now();
    const p = spawn("claude", args, { env, cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => p.kill("SIGTERM"), RUN_TIMEOUT_MS);
    p.on("close", (code) => {
      clearTimeout(timer);
      const lines = out.split("\n").filter(Boolean).flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      done({ lines, ms: Date.now() - t0, error: code === 0 ? undefined : `exit ${code}: ${err.slice(-300)}` });
    });
  });
}

async function runOne(task: Task, arm: string, rep: number): Promise<Run | undefined> {
  let vars: Record<string, string>;
  try {
    vars = task.setup() ?? {};
  } catch (e) {
    // The app did not let us seed the test data (busy, or a modal dialog); the run is skipped, not failed.
    appendFileSync(log, JSON.stringify({ task: task.id, app: task.app, arm, rep, setup_failed: true, error: String((e as Error).message).slice(0, 120) }) + "\n");
    return undefined;
  }
  const prompt = task.prompt.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? `{${k}}`);
  const before = FINGERPRINT[task.app]?.();
  const cwd = mkdtempSync(join(tmpdir(), "mcpify-run-"));
  const args = ["-p", prompt, "--model", MODEL, "--max-turns", String(MAX_TURNS), "--output-format", "stream-json", "--verbose", "--append-system-prompt", SYSTEM, "--setting-sources", "project", "--settings", SETTINGS, ...armArgs(task, arm, cwd)];
  const env = { ...process.env, PATH: `${shimDir}:${process.env.PATH}` };
  const { lines, ms, error } = await runClaude(args, env, cwd);
  // Full transcripts and answers stay local (gitignored): an agent that wanders can quote real data.
  writeFileSync(join(LOCAL, `${task.id}-${arm}-${rep}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
  const result = lines.find((l) => l.type === "result");
  const uses = lines.flatMap((l) => (l.type === "assistant" ? l.message.content.filter((c: any) => c.type === "tool_use") : []));
  const toolResults = lines.flatMap((l) => (l.type === "user" ? (l.message.content ?? []).filter?.((c: any) => c.type === "tool_result") ?? [] : []));
  const answer = String(result?.result ?? "");
  let ok = false, checkErr: string | undefined;
  try {
    ok = task.check(answer, vars);
  } catch (e) {
    checkErr = `check: ${(e as Error).message.slice(0, 200)}`;
  }
  let collateral = false;
  try {
    collateral = before !== undefined && JSON.stringify(FINGERPRINT[task.app]()) !== JSON.stringify(before);
  } catch {}
  try {
    CLEANUP[task.app]?.();
  } catch {}
  return {
    task: task.id,
    app: task.app,
    arm,
    rep,
    ok,
    collateral,
    turns: result?.num_turns,
    toolCalls: uses.length,
    toolErrors: toolResults.filter((r: any) => r.is_error).length,
    ms,
    costUsd: result?.total_cost_usd,
    answer: answer.slice(0, 400),
    error: error ?? checkErr ?? (result?.subtype && result.subtype !== "success" ? result.subtype : undefined),
  };
}

const tasks = TASKS.filter((t) => (!ONLY.length || ONLY.includes(t.id)) && (!APPS.length || APPS.includes(t.app)));
mkdirSync(join(ROOT, "bench/results"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const log = join(ROOT, `bench/results/agent-${stamp}.jsonl`);
const LOCAL = join(ROOT, "bench/results/local", stamp);
mkdirSync(LOCAL, { recursive: true });
for (let rep = 1; rep <= REPS; rep++) {
  for (const task of tasks) {
    // Alternate which arm goes first so neither always meets a freshly launched app.
    const order = (TASKS.indexOf(task) + rep) % 2 ? ARMS : [...ARMS].reverse();
    for (const arm of order) {
      const r = await runOne(task, arm, rep);
      if (!r) {
        console.error(`SKIP ${arm.padEnd(9)} ${task.id.padEnd(20)} setup failed`);
        continue;
      }
      const { answer, ...shareable } = r;
      appendFileSync(log, JSON.stringify(shareable) + "\n");
      appendFileSync(join(LOCAL, "answers.jsonl"), JSON.stringify({ task: r.task, arm, rep, answer }) + "\n");
      console.error(`${r.ok ? "PASS" : "FAIL"} ${arm.padEnd(9)} ${task.id.padEnd(20)} ${(r.ms / 1000).toFixed(1)}s ${r.toolCalls} calls${r.collateral ? " COLLATERAL" : ""}${r.error ? ` (${r.error.slice(0, 80)})` : ""}`);
    }
  }
}
console.log(log);
