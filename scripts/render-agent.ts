// Turn a `claude -p --output-format stream-json` log into demo/agent-transcript.md.
import { readFileSync, writeFileSync } from "node:fs";
const [log, prompt] = process.argv.slice(2);
const out = ["# Agent demo: Claude Code using mcpify-notes", "", `Prompt: ${prompt}`, ""];
for (const line of readFileSync(log, "utf8").split("\n").filter(Boolean)) {
  const r = JSON.parse(line);
  if (r.type === "system" && r.subtype === "init") out.push(`MCP servers: ${JSON.stringify(r.mcp_servers)}`, `Notes tools offered: ${r.tools.filter((t: string) => t.startsWith("mcp__notes")).join(", ")}`, "");
  if (r.type === "assistant") for (const c of r.message.content) {
    if (c.type === "tool_use" && c.name.startsWith("mcp__")) out.push(`**agent calls** \`${c.name}\` \`${JSON.stringify(c.input)}\``, "");
    if (c.type === "text") out.push(`**agent says:** ${c.text}`, "");
  }
  if (r.type === "user") for (const c of r.message.content ?? []) {
    if (c?.type !== "tool_result") continue;
    const text = typeof c.content === "string" ? c.content : c.content.map((x: any) => x.text ?? "").join("");
    if (text.trim()) out.push("```json", text.trim(), "```", "");
  }
  if (r.type === "result") out.push(`Run: ${r.num_turns} turns, ${(r.duration_ms / 1000).toFixed(1)} s.`);
}
writeFileSync("demo/agent-transcript.md", out.join("\n").replace(/x-coredata:\/\/[0-9A-F-]{36}\//g, "x-coredata://<store>/") + "\n");
