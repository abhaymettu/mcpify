// Records a real MCP session against the real Notes app into demo/transcript.md.
// Only touches the "mcpify-test" folder; list_folders output is filtered to that folder
// so the transcript never shows the owner's other folders.
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const osa = (code: string) => execFileSync("osascript", ["-l", "JavaScript", "-e", code], { encoding: "utf8" }).trim();
const client = new Client({ name: "mcpify-demo", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "serve", "notes"] }));

const out: string[] = [`# mcpify demo transcript`, ``, `Recorded ${new Date().toISOString()} on macOS against the real Notes app, over stdio with the official MCP client.`, ``];
const tools = await client.listTools();
out.push(`## tools/list`, "", ...tools.tools.map((t) => `- \`${t.name}\`${t.annotations?.readOnlyHint ? " (read only)" : " (writes)"}: ${t.description}`), "");

async function step(label: string, name: string, args: Record<string, unknown>, show?: (r: any) => unknown) {
  const t0 = performance.now();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const ms = Math.round(performance.now() - t0);
  const result = res.isError ? (res.content as any)[0].text : (res.structuredContent as any).result;
  out.push(`## ${label}`, "", "```json", `// call ${name} ${JSON.stringify(args)}`, `// ${ms} ms${res.isError ? ", isError" : ""}`, JSON.stringify(show && !res.isError ? show(result) : result, null, 2), "```", "");
  return result;
}

const folders = await step("Find the folder", "list_folders", {}, (r) => ({ shown: r.filter((f: any) => f.name === "mcpify-test"), other_folders_omitted: r.length - 1 }));
const folder = folders.find((f: any) => f.name === "mcpify-test");
if (!folder) throw new Error('create a "mcpify-test" folder in Notes first (npm test does this)');
const made = await step("Create a note", "create_note", { title: "Trip packing list", body: "passport\nchargers\nrain jacket", folder_id: folder.id });
await step("Search for it", "search_notes", { query: "rain jacket" }, (r) => ({ ...r, notes: r.notes.filter((n: any) => n.id === made.id), other_matches_omitted: r.total - 1 }));
await step("Add a line", "update_note", { id: made.id, text: "sunscreen", mode: "append" });
await step("Read it back", "read_note", { id: made.id }, ({ html, ...rest }) => rest);
await step("A note that does not exist", "read_note", { id: "x-coredata://00000000-0000-0000-0000-000000000000/ICNote/p1" });
await client.close();

const check = osa(`const n=Application("Notes").notes.byId(${JSON.stringify(made.id)});JSON.stringify({name:n.name(),text:n.plaintext()})`);
out.push(`## Independent check (raw osascript, not mcpify)`, "", "```json", check, "```", "");
osa(`const a=Application("Notes");a.delete(a.notes.byId(${JSON.stringify(made.id)}));"ok"`);
out.push(`The demo note was then deleted (it goes to Notes' Recently Deleted).`, "");
// Note ids embed the Notes store UUID, a per-device identifier; mask it.
writeFileSync("demo/transcript.md", out.join("\n").replace(/x-coredata:\/\/[0-9A-F-]{36}\//g, "x-coredata://<store>/"));
console.log("wrote demo/transcript.md");
