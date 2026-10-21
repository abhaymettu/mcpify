// The inspector reads real dictionaries with `sdef`; no fixtures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectApp } from "../src/sdef.ts";

test("Notes dictionary exposes the note class the adapter uses", async () => {
  const s = await inspectApp("/System/Applications/Notes.app");
  assert.equal(s.scriptable, true);
  const note = s.suites.flatMap((x) => x.classes).find((c) => c.name === "note");
  assert.ok(note);
  for (const p of ["name", "id", "body", "plaintext", "modification date", "password protected"]) assert.ok(note.properties.includes(p), p);
});

test("an app with no dictionary is reported as not scriptable", async () => {
  const s = await inspectApp("/System/Applications/Calculator.app");
  assert.equal(s.scriptable, false);
  assert.deepEqual(s.suites, []);
});
