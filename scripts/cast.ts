// Turn a recorded Claude Code run (stream-json) into an asciicast, replayed at a readable pace.
// The text shown is the run's own tool calls and results; only waits are shortened (and labelled).
//   node scripts/cast.ts run.jsonl "<setup command shown first>" "<prompt>" > demo.cast && agg demo.cast demo.gif
import { readFileSync } from "node:fs";

const [file, setup, prompt] = process.argv.slice(2);
const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const W = 100;
const events: [number, string][] = [];
let t = 0.3;
const out = (s: string, dt = 0.05) => {
  t += dt;
  events.push([Number(t.toFixed(3)), s]);
};
const type = (s: string) => {
  for (const ch of s) out(ch, 0.025);
};
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const wrap = (s: string, indent: string) => {
  const rows: string[] = [];
  for (const raw of s.split("\n")) for (let i = 0; i < raw.length || i === 0; i += W - indent.length) rows.push(indent + raw.slice(i, i + W - indent.length));
  return rows.join("\r\n");
};
const short = (v: unknown) => JSON.stringify(v).replace(/"(\w[\w ]*)":/g, "$1:").replace(/\\"/g, '"');

out("\x1b[1;32m$\x1b[0m ", 0.2);
type(setup);
out("\r\n", 0.6);
out("\x1b[1;32m$\x1b[0m ", 0.4);
type(`claude -p "${prompt}"`);
out("\r\n", 0.8);

for (const l of lines) {
  if (l.type === "assistant") {
    for (const c of l.message.content) {
      if (c.type === "tool_use") {
        const name = c.name.replace(/^mcp__\w+?__/, "");
        out(`\r\n\x1b[1;36m●\x1b[0m \x1b[1m${name}\x1b[0m ${dim(wrap(short(c.input), "").slice(0, 300))}\r\n`, 0.5);
      } else if (c.type === "text" && c.text.trim()) {
        out(`\r\n${wrap(c.text.trim(), "")}\r\n`, 0.6);
      }
    }
  } else if (l.type === "user") {
    for (const c of l.message.content ?? []) {
      if (c.type !== "tool_result") continue;
      const body = (Array.isArray(c.content) ? c.content.map((x: { text?: string }) => x.text ?? "").join("") : String(c.content)).trim();
      let shown = body;
      try {
        shown = JSON.stringify(JSON.parse(body).result ?? JSON.parse(body), null, 1).replace(/\n\s*/g, " ");
      } catch {}
      out(`${dim(wrap(`⎿ ${shown.slice(0, 380)}${shown.length > 380 ? " …" : ""}`, "  "))}\r\n`, 1.2);
    }
  } else if (l.type === "result") {
    out(`\r\n${dim(`(${l.num_turns} turns, ${(l.duration_ms / 1000).toFixed(1)} s; waits shortened in this replay)`)}\r\n`, 0.5);
  }
}
out("", 3);
console.log(JSON.stringify({ version: 2, width: W, height: 30, title: "mcpify", env: { TERM: "xterm-256color" } }));
for (const [ts, s] of events) console.log(JSON.stringify([ts, "o", s]));
