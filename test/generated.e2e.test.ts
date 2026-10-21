// `mcpify generate` builds a server from Notes' scripting dictionary with no Notes-specific code.
// Its answers are checked against raw osascript reads of the real app. Read only, except the one
// seed note this file creates (with raw osascript) and deletes again. A run cut off by a Notes
// timeout can leave its seed behind (or an empty "New Note" if the create was interrupted), so
// before() first removes those leftovers from the mcpify-test folder, and nothing else.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function osa<T>(fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application("Notes");const args=JSON.parse(argv[0]);return JSON.stringify((${fn})(app,args));}`;
  return JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8", timeout: 180_000 }));
}

let client: Client;
let seed = { id: "", folderId: "" };
const TOKEN = `mcpifygen${Date.now().toString(36)}`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const text = (res.content as { text: string }[])[0]?.text ?? "";
  return { isError: Boolean(res.isError), text, data: res.isError ? undefined : (res.structuredContent as { result: any }).result };
}

before(async () => {
  seed = osa(`(app,a)=>{const acc=app.defaultAccount();if(!acc.folders.whose({name:"mcpify-test"}).length)acc.folders.push(app.Folder({name:"mcpify-test"}));const f=acc.folders.byName("mcpify-test");f.notes().forEach(o=>{const nm=o.name();if(nm.startsWith("mcpifygen")||(nm==="New Note"&&o.plaintext().trim()===""))app.delete(o)});const n=app.Note({body:"<div><h1>"+a.t+"</h1></div><div>generated check</div>"});f.notes.push(n);return {id:n.id(),folderId:f.id()}}`, { t: TOKEN });
  client = new Client({ name: "mcpify-gen-e2e", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "generate", "/System/Applications/Notes.app"] }));
});

after(async () => {
  await client?.close();
  if (seed.id) osa(`(app,a)=>{app.delete(app.notes.byId(a.id));return true}`, { id: seed.id });
});

describe("mcpify generate /System/Applications/Notes.app", () => {
  test("derives list and get tools for every top-level class, all read only", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["get_account", "get_attachment", "get_folder", "get_note", "list_accounts", "list_attachments", "list_folders", "list_notes"]);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });

  test("list_folders and list_accounts agree with the app", async () => {
    const raw = osa<{ folders: number; accounts: number }>(`(app)=>({folders:app.folders.length,accounts:app.accounts.length})`);
    const f = await call("list_folders", { limit: 1000 });
    assert.equal(f.data.total, raw.folders);
    assert.ok(f.data.items.some((x: any) => x.id === seed.folderId && x.name === "mcpify-test"));
    const a = await call("list_accounts");
    assert.equal(a.data.total, raw.accounts);
  });

  test("get_note reads the seed note's properties by id", async () => {
    const { data } = await call("get_note", { id: seed.id });
    assert.equal(data.name, TOKEN);
    assert.equal(data.id, seed.id);
    assert.ok(data.plaintext.includes("generated check"));
    assert.equal(data["password protected"], false);
    assert.ok(!Number.isNaN(Date.parse(data["modification date"])));
  });

  test("get_folder reads a folder; a bad id is a tool error", async () => {
    const { data } = await call("get_folder", { id: seed.folderId });
    assert.equal(data.name, "mcpify-test");
    const bad = await call("get_note", { id: "x-coredata://00000000-0000-0000-0000-000000000000/ICNote/p1" });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /no note with id/);
  });
});
