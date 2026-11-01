// Print a local agent transcript compactly: node scripts/show-run.ts bench/results/local/<stamp>/<task>-<arm>-<rep>.jsonl
import { readFileSync } from "node:fs";
for (const l of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x))) {
  if (l.type === "assistant") for (const c of l.message.content) {
    if (c.type === "tool_use") console.log("CALL", c.name, JSON.stringify(c.input).slice(0, 300));
    if (c.type === "text") console.log("TEXT", c.text.slice(0, 300));
  }
  if (l.type === "user") for (const c of l.message.content ?? []) if (c.type === "tool_result") console.log("RES ", c.is_error ? "ERR" : "", JSON.stringify(c.content).slice(0, 300));
}
