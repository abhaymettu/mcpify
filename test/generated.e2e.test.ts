// `mcpify /System/Applications/Notes.app` builds a server from Notes' scripting dictionary with no Notes-specific code.
// Its answers are checked against raw osascript reads of the real app. Read only, except the one
// seed note this file creates (with raw osascript) and deletes again. A run cut off by a Notes
// timeout can leave its seed behind (or an empty "New Note" if the create was interrupted), so
// before() first removes those leftovers from the mcpify-test folder, and nothing else
// (clearLeftovers below; the last test plants both kinds and checks they are removed).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const [osaCmd, ...osaPre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);
function osa<T>(fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application("Notes");const args=JSON.parse(argv[0]);return JSON.stringify((${fn})(app,args));}`;
  return JSON.parse(execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8", timeout: 180_000 }));
}

let client: Client;
let seed = { id: "", folderId: "" };
const TOKEN = `mcpifygen${Date.now().toString(36)}`;

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  const text = (res.content as { text: string }[])[0]?.text ?? "";
  return { isError: Boolean(res.isError), text, data: res.isError ? undefined : (res.structuredContent as { result: any }).result };
}

// The test folder, created if missing. JXA source, used inside osa() calls.
const FOLDER = `((app)=>{const acc=app.defaultAccount();if(!acc.folders.whose({name:"mcpify-test"}).length)acc.folders.push(app.Folder({name:"mcpify-test"}));return acc.folders.byName("mcpify-test")})`;

// Leftovers in the test folder: an old seed (name starts with "mcpifygen") or an empty note.
// Notes gives an empty note the name "New Note" and the plaintext "New Note\n" (checked on macOS
// 26.5 with app.Note({}) and app.Note({body:""})), so plaintext "New Note" counts as empty too.
// A "New Note" with any other text is kept. `keep` spares one note id.
function clearLeftovers(keep = ""): number {
  return osa<number>(`(app,a)=>{const f=${FOLDER}(app);let n=0;f.notes().forEach(o=>{if(o.id()===a.keep)return;const nm=o.name(),pt=o.plaintext().trim();if(nm.startsWith("mcpifygen")||(nm==="New Note"&&(pt===""||pt==="New Note"))){app.delete(o);n++}});return n}`, { keep });
}

before(async () => {
  clearLeftovers();
  seed = osa(`(app,a)=>{const f=${FOLDER}(app);const n=app.Note({body:"<div><h1>"+a.t+"</h1></div><div>generated check</div>"});f.notes.push(n);return {id:n.id(),folderId:f.id()}}`, { t: TOKEN });
  client = new Client({ name: "mcpify-gen-e2e", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "/System/Applications/Notes.app"], env: process.env as Record<string, string> }));
});

after(async () => {
  await client?.close();
  if (seed.id) osa(`(app,a)=>{app.delete(app.notes.byId(a.id));return true}`, { id: seed.id });
});

describe("mcpify generate /System/Applications/Notes.app", () => {
  test("derives list and get tools for every reachable class, all read only", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const n of ["list_accounts", "get_account", "list_folders", "get_folder", "list_notes", "get_note", "list_attachments", "get_attachment"]) assert.ok(names.includes(n), n);
    for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  });

  test("list_folders and list_accounts agree with the app", async () => {
    const raw = osa<{ folders: number; accounts: number }>(`(app)=>({folders:app.folders.length,accounts:app.accounts.length})`);
    const f = await call("list_folders", { limit: 1000 });
    assert.equal(f.data.total, raw.folders);
    assert.ok(f.data.items.some((x: any) => x.id === seed.folderId && x.name === "mcpify-test" && x.ref === `folders[id=${JSON.stringify(seed.folderId)}]`));
    const found = await call("list_notes", { parent: `folders[id=${JSON.stringify(seed.folderId)}]`, where: { name: TOKEN } });
    assert.equal(found.data.total, 1, "where filters inside the folder");
    const a = await call("list_accounts");
    assert.equal(a.data.total, raw.accounts);
  });

  test("get_note reads the seed note's properties by id", async () => {
    const { data } = await call("get_note", { ref: `notes[id=${JSON.stringify(seed.id)}]` });
    assert.equal(data.name, TOKEN);
    assert.equal(data.id, seed.id);
    assert.ok(data.plaintext.includes("generated check"));
    assert.equal(data["password protected"], false);
    assert.ok(!Number.isNaN(Date.parse(data["modification date"])));
  });

  test("get_folder reads a folder; a bad id is a tool error", async () => {
    const { data } = await call("get_folder", { ref: `folders[id=${JSON.stringify(seed.folderId)}]` });
    assert.equal(data.name, "mcpify-test");
    const bad = await call("get_note", { ref: 'notes[id="x-coredata://00000000-0000-0000-0000-000000000000/ICNote/p1"]' });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /no note at/);
  });
});

describe("leftover cleanup in the mcpify-test folder", () => {
  test("removes an old seed and an empty New Note, and keeps a New Note with text and the live seed", () => {
    const planted = osa<{ oldSeed: string; empty: string; kept: string }>(`(app)=>{const f=${FOLDER}(app);const mk=(p)=>{const n=app.Note(p);f.notes.push(n);return n.id()};return {oldSeed:mk({body:"<div><h1>mcpifygenleftover</h1></div><div>old seed</div>"}),empty:mk({}),kept:mk({body:"<div>New Note</div><div>real words here</div>"})}}`);
    try {
      const before = osa<Record<string, string>>(`(app,a)=>{const g=(id)=>{const n=app.notes.byId(id);return {name:n.name(),plain:n.plaintext()}};return {oldSeed:g(a.oldSeed),empty:g(a.empty),kept:g(a.kept)}}`, planted);
      assert.deepEqual(before.empty, { name: "New Note", plain: "New Note\n" }, "the empty note has the shape the cleanup matches");
      assert.equal((before.kept as any).name, "New Note");
      clearLeftovers(seed.id);
      const left = osa<string[]>(`(app)=>${FOLDER}(app).notes().map(o=>o.id())`);
      assert.ok(!left.includes(planted.oldSeed), "old seed removed");
      assert.ok(!left.includes(planted.empty), "empty New Note removed");
      assert.ok(left.includes(planted.kept), "a New Note with text is kept");
      assert.ok(left.includes(seed.id), "the live seed is kept");
    } finally {
      osa(`(app,a)=>{for(const id of [a.oldSeed,a.empty,a.kept]){try{app.delete(app.notes.byId(id))}catch(e){}}return true}`, planted);
    }
  });
});
