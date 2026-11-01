// Summarise agent runs: node bench/summarize.ts bench/results/agent-*.jsonl > bench/results/agent.md
import { readFileSync } from "node:fs";

interface Run {
  task: string;
  app: string;
  arm: string;
  rep: number;
  ok: boolean;
  collateral: boolean;
  toolCalls: number;
  toolErrors: number;
  ms: number;
  costUsd?: number;
  error?: string;
}

const all = process.argv.slice(2).flatMap((f) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
// A task relaunched after an interrupted worker can appear twice for one arm; the first completed run counts.
const seen = new Set<string>();
const runs: Run[] = all.filter((r) => !r.setup_failed && !seen.has(`${r.task}|${r.arm}|${r.rep}`) && seen.add(`${r.task}|${r.arm}|${r.rep}`));
const skipped = all.length - runs.length;
const arms = [...new Set(runs.map((r) => r.arm))];
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
};
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(0)}%` : "n/a");

const lines: string[] = [];
lines.push(`${runs.length} runs, ${new Set(runs.map((r) => r.task)).size} tasks, ${new Set(runs.map((r) => r.app)).size} apps, ${skipped} skipped because seeding the test data failed, files: ${process.argv.slice(2).map((f) => f.split("/").pop()).join(", ")}`, "");
lines.push("| Arm | Success | Collateral changes | Median tool calls | Median tool errors | Median time | Total cost (API-equivalent) |", "|---|---|---|---|---|---|---|");
for (const arm of arms) {
  const rs = runs.filter((r) => r.arm === arm);
  lines.push(`| ${arm} | ${rs.filter((r) => r.ok).length}/${rs.length} (${pct(rs.filter((r) => r.ok).length, rs.length)}) | ${rs.filter((r) => r.collateral).length} | ${median(rs.map((r) => r.toolCalls))} | ${median(rs.map((r) => r.toolErrors))} | ${(median(rs.map((r) => r.ms)) / 1000).toFixed(1)} s | $${rs.reduce((a, r) => a + (r.costUsd ?? 0), 0).toFixed(2)} |`);
}
lines.push("", "By app:", "", `| App | ${arms.join(" | ")} |`, `|---|${arms.map(() => "---").join("|")}|`);
for (const app of [...new Set(runs.map((r) => r.app))]) {
  lines.push(`| ${app} | ${arms.map((a) => { const rs = runs.filter((r) => r.app === app && r.arm === a); return `${rs.filter((r) => r.ok).length}/${rs.length}`; }).join(" | ")} |`);
}
lines.push("", "By task:", "", `| Task | ${arms.join(" | ")} |`, `|---|${arms.map(() => "---").join("|")}|`);
for (const task of [...new Set(runs.map((r) => r.task))]) {
  lines.push(`| ${task} | ${arms.map((a) => runs.filter((r) => r.task === task && r.arm === a).map((r) => (r.ok ? "pass" : `fail${r.error ? ` (${r.error.slice(0, 40)})` : ""}`)).join(", ")).join(" | ")} |`);
}
console.log(lines.join("\n"));
