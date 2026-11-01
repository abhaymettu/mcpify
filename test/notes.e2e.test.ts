// End to end: a real MCP client talks over stdio to `mcpify serve notes`, which drives the
// real Notes app. No mocks. Everything happens inside one persistent folder, "mcpify-test", and
// each run deletes the notes it made. Creating and deleting folders makes Notes rebuild its sidebar
// and stop answering Apple Events for minutes, so the folder is reused, never churned.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Independent check path: raw osascript, no mcpify code involved.
const [osaCmd, ...osaPre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);
function osa<T>(fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application("Notes");const args=JSON.parse(argv[0]);return JSON.stringify((${fn})(app,args));}`;
  return JSON.parse(execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8" }));
}

const TOKEN = `mcpifyprobe${Date.now().toString(36)}`;
const FOLDER = "mcpify-test";
const created: string[] = [];
let folderId = "";
let client: Client;
const timings: Record<string, number[]> = {};

async function call(name: string, args: Record<string, unknown> = {}) {
  const t0 = performance.now();
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 });
  (timings[name] ??= []).push(performance.now() - t0);
  const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
  return { isError: Boolean(res.isError), text, data: res.isError ? undefined : (res.structuredContent as { result: any }).result };
}

// Notes can be busy (sync, sidebar rebuilds). Wait until it answers quickly twice in a row.
function waitForNotes() {
  let fast = 0;
  for (let i = 0; i < 30 && fast < 2; i++) {
    const t0 = Date.now();
    try {
      execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", 'Application("Notes").folders.length'], { timeout: 20_000 });
      fast = Date.now() - t0 < 3000 ? fast + 1 : 0;
    } catch {
      fast = 0;
    }
  }
  assert.equal(fast, 2, "Notes never became responsive");
}

before(async () => {
  waitForNotes();
  folderId = osa<string>(`(app,a)=>{const acc=app.defaultAccount();if(!acc.folders.whose({name:a.name}).length)acc.folders.push(app.Folder({name:a.name}));return acc.folders.byName(a.name).id();}`, { name: FOLDER });
  // Leftovers from an interrupted run would break the counts below.
  osa(`(app,a)=>{const f=app.folders.byId(a.id);f.notes().forEach(n=>app.delete(n));return true}`, { id: folderId });
  client = new Client({ name: "mcpify-e2e", version: "0.0.0" }, { capabilities: {} });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ["src/cli.ts", "serve", "notes"], env: process.env as Record<string, string> }));
});

after(async () => {
  await client?.close();
  if (created.length) osa(`(app,a)=>{a.ids.forEach(id=>app.delete(app.notes.byId(id)));return true}`, { ids: created });
  const left = osa<number>(`(app,a)=>app.folders.byId(a.id).notes.length`, { id: folderId });
  assert.equal(left, 0, "this run's notes should be gone");
  const summary = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, `${v.length} calls, median ${Math.round(v.sort((a, b) => a - b)[Math.floor(v.length / 2)])} ms`]));
  console.log("TIMINGS", JSON.stringify(summary));
});

describe("mcpify serve notes, against the real Notes app", () => {
  let noteId = "";
  const title = `Grocery plan ${TOKEN}`;
  const tricky = `milk & eggs <b>not bold</b>\n"); app.quit(); ("\n\nlast line`;

  test("exposes exactly six tools with honest read/write hints", async () => {
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.deepEqual(Object.keys(byName).sort(), ["create_note", "list_folders", "list_notes", "read_note", "search_notes", "update_note"]);
    for (const n of ["list_folders", "list_notes", "search_notes", "read_note"]) assert.equal(byName[n].annotations?.readOnlyHint, true, n);
    for (const n of ["create_note", "update_note"]) assert.equal(byName[n].annotations?.readOnlyHint, false, n);
  });

  test("list_folders sees the empty test folder", async () => {
    const { data } = await call("list_folders");
    const f = data.find((x: any) => x.id === folderId);
    assert.ok(f, "test folder listed");
    assert.equal(f.name, FOLDER);
    assert.equal(f.note_count, 0);
  });

  test("create_note writes a real note, text stored literally", async () => {
    const { data, isError, text } = await call("create_note", { title, body: tricky, folder_id: folderId });
    assert.equal(isError, false, text);
    noteId = data.id;
    created.push(noteId);
    assert.match(noteId, /^x-coredata:\/\//);
    assert.equal(data.folder_id, folderId);
    const real = osa<{ name: string; text: string; folder: string }>(`(app,a)=>{const n=app.notes.byId(a.id);return {name:n.name(),text:n.plaintext(),folder:n.container().id()}}`, { id: noteId });
    assert.equal(real.name, title);
    assert.equal(real.folder, folderId);
    for (const line of tricky.split("\n").filter(Boolean)) assert.ok(real.text.includes(line), `missing line: ${line}`);
  });

  test("list_notes on the folder returns that note", async () => {
    const { data } = await call("list_notes", { folder_id: folderId });
    assert.equal(data.total, 1);
    assert.equal(data.notes[0].id, noteId);
    assert.equal(data.notes[0].name, title);
  });

  test("search_notes finds it by a unique token, ignoring case, with a snippet", async () => {
    const lower = await call("search_notes", { query: TOKEN });
    assert.equal(lower.data.total, 1);
    assert.equal(lower.data.notes[0].id, noteId);
    assert.ok(lower.data.notes[0].snippet.toLowerCase().includes(TOKEN));
    const upper = await call("search_notes", { query: TOKEN.toUpperCase() });
    assert.equal(upper.data.total, 1);
    const body = await call("search_notes", { query: `${TOKEN}zz-absent` });
    assert.equal(body.data.total, 0);
    assert.deepEqual(body.data.notes, []);
  });

  test("read_note returns text, html and folder", async () => {
    const { data } = await call("read_note", { id: noteId });
    assert.equal(data.name, title);
    assert.equal(data.folder_id, folderId);
    assert.equal(data.locked, false);
    assert.equal(data.attachments, 0);
    assert.ok(data.text.includes("milk & eggs <b>not bold</b>"));
    // Notes rewrites entities without the semicolon (&ltb&gt), so check it is escaped text, not a real tag.
    assert.ok(data.html.includes("not bold"));
    assert.ok(!data.html.includes("<b>not bold</b>"), "user text never becomes markup");
  });

  test("update_note append keeps the old text and adds the new", async () => {
    const { isError, text } = await call("update_note", { id: noteId, text: "bread too", mode: "append" });
    assert.equal(isError, false, text);
    const real = osa<string>(`(app,a)=>app.notes.byId(a.id).plaintext()`, { id: noteId });
    assert.ok(real.includes("milk & eggs <b>not bold</b>"), "old text survives the HTML round trip");
    assert.ok(real.trimEnd().endsWith("bread too"));
  });

  test("update_note replace swaps body and title", async () => {
    const newTitle = `Renamed ${TOKEN}`;
    const { data } = await call("update_note", { id: noteId, text: "only this now", mode: "replace", title: newTitle });
    assert.equal(data.name, newTitle);
    const real = osa<{ name: string; text: string }>(`(app,a)=>{const n=app.notes.byId(a.id);return {name:n.name(),text:n.plaintext()}}`, { id: noteId });
    assert.equal(real.name, newTitle);
    assert.ok(real.text.includes("only this now"));
    assert.ok(!real.text.includes("milk"));
  });

  test("bad ids come back as tool errors, not crashes", async () => {
    const r = await call("read_note", { id: "x-coredata://00000000-0000-0000-0000-000000000000/ICNote/p999999999" });
    assert.equal(r.isError, true);
    assert.match(r.text, /no note with id/);
    const c = await call("create_note", { title: "never", folder_id: "x-coredata://00000000-0000-0000-0000-000000000000/ICFolder/p999999999" });
    assert.equal(c.isError, true);
    assert.match(c.text, /no folder with id/);
    const still = osa<number>(`(app,a)=>app.folders.byId(a.id).notes.length`, { id: folderId });
    assert.equal(still, 1, "failed create left nothing behind");
  });
});
