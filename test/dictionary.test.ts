// The dictionary model and the generator, on the real dictionaries installed with macOS. No Apple Events.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectApp } from "../src/sdef.ts";
import { adapterFromDictionary, reachable } from "../src/generate.ts";
import { formatRef, parseRef } from "../src/ref.ts";

const dict = (app: string) => inspectApp(`/System/Applications/${app}.app`);

test("Notes: note properties, and Standard Suite commands pulled in through xi:include", async () => {
  const d = await dict("Notes");
  assert.equal(d.scriptable, true);
  const note = d.classes.get("note")!;
  for (const p of ["name", "id", "body", "plaintext", "modification date", "password protected"]) assert.ok(note.properties.some((q) => q.name === p), p);
  assert.ok(d.commands.some((c) => c.name === "make"), "make comes from CocoaStandard.sdef");
});

test("Calendar: events are identified by uid, found through the ID code rather than the name", async () => {
  const c = reachable(await dict("Calendar"));
  assert.equal(c.get("event")!.idProp?.name, "uid");
  assert.deepEqual(c.get("event")!.parents, ["calendar"]);
  assert.equal(c.get("event")!.depth, 2);
});

test("Reminders: inheritance and class extensions merge into one class", async () => {
  const d = await dict("Reminders");
  const app = d.classes.get("application")!;
  for (const e of ["account", "list", "reminder"]) assert.ok(app.elements.some((x) => x.type === e), e);
  const r = d.classes.get("reminder")!;
  assert.equal(r.properties.find((p) => p.name === "id")!.access, "r");
  assert.equal(r.properties.find((p) => p.name === "due date")!.access, "rw");
});

test("an app with no dictionary is reported as not scriptable", async () => {
  const d = await inspectApp("/System/Applications/Calculator.app");
  assert.equal(d.scriptable, false);
});

test("read only by default; writes and deletes only behind their flags", async () => {
  const d = await dict("Reminders");
  const names = (o = {}) => adapterFromDictionary("Reminders", d, o).tools.map((t) => t.name);
  assert.ok(names().every((n) => /^(list|get)_/.test(n)), "default is read only");
  assert.ok(names({ writes: true }).includes("create_reminder"));
  assert.ok(!names({ writes: true }).some((n) => n.startsWith("delete_")), "no deletes without --allow-delete");
  assert.ok(names({ writes: true, allowDelete: true }).includes("delete_reminder"));
  assert.ok(!names({ writes: true, allowDelete: true }).includes("delete_account"), "accounts are read-only elements");
});

test("refs: parse, format, and check against the dictionary", async () => {
  const ref = 'calendars[name="mcpify-test"]/events[id="A/B\\"C"]';
  assert.equal(formatRef(parseRef(ref)), ref);
  assert.deepEqual(parseRef("lists[index=2]"), [["lists", "index", 2]]);
  assert.throws(() => parseRef('lists[id="x"]; do shell script "x"'), /not a ref/);
  const a = adapterFromDictionary("Calendar", await dict("Calendar"));
  assert.equal(a.checkRef!(ref).cls, "event");
  assert.throws(() => a.checkRef!('events[id="x"]'), /has no events/);
  assert.throws(() => a.checkRef!('constructor[id="x"]'), /unknown element/);
});
