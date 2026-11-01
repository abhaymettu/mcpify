// Test containers for the live coverage run and the agent suite. Everything mcpify writes in a run goes
// into these containers (or is a test object it creates and deletes by ref), so a run never touches real data.
import { rmSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

// `raw` expressions are plain JXA, written by hand, used to check results without going through mcpify.

export interface RoundTrip {
  /** Class whose create_/update_/delete_ tools the round trip exercises. */
  cls: string;
  /** Ref of the container to create in (omit to create at the app's top level). */
  parent?: string;
  /** Properties for create_; NAME is replaced with a unique test name. */
  create: Record<string, unknown>;
  /** Property for update_, and the JXA property name used to read it back. */
  update: [prop: string, value: unknown, jxa: string];
  /** JXA (app, name) => matching objects, as an array of specifiers, found without mcpify. */
  find: string;
}

export interface Fixture {
  app: string;
  /** Personal-data apps: the read sweep stays inside the test container and filters top-level lists to test names. */
  sensitive?: boolean;
  /** JXA (app) => void, idempotent: makes the test container. A string it returns fills {doc} in scope and parent. */
  setup?: string;
  /** JXA (app) => void, or a Node function: removes what setup made. */
  teardown?: string | (() => void);
  /** Refs the sweep starts from (test containers), and the --scope for writes. */
  scope?: string[];
  /** Start the sweep from these refs without restricting writes to them. */
  sweep?: string[];
  roundTrip?: RoundTrip;
  /** Set to run through another osascript (an app that holds the grant), e.g. Contacts needs the caller to have Contacts access. */
  why?: string;
}

const T = "mcpify-test";
/** ~/mcpify-test as a Finder ref (Finder cannot see hidden folders such as /private/tmp). */
export const HOME_REF = `disks[name="Macintosh HD"]/folders[name="Users"]/folders[name=${JSON.stringify(userInfo().username)}]/folders[name="${T}"]`;

export const FIXTURES: Fixture[] = [
  {
    app: "Reminders",
    sensitive: true,
    setup: `(app) => { if (!app.lists.whose({ name: "${T}" }).length) app.lists.push(app.List({ name: "${T}" })); }`,
    teardown: `(app) => { app.lists.whose({ name: "${T}" })().forEach((l) => app.delete(l)); }`,
    scope: [`lists[name="${T}"]`],
    roundTrip: { cls: "reminder", parent: `lists[name="${T}"]`, create: { name: "NAME", priority: 1 }, update: ["completed", true, "completed"], find: `(app, n) => app.lists.byName("${T}").reminders.whose({ name: n })()` },
  },
  {
    app: "Notes",
    sensitive: true,
    setup: `(app) => { const a = app.defaultAccount(); if (!a.folders.whose({ name: "${T}" }).length) a.folders.push(app.Folder({ name: "${T}" })); }`,
    scope: [`folders[name="${T}"]`],
    roundTrip: { cls: "note", parent: `folders[name="${T}"]`, create: { body: "<div><h1>NAME</h1></div><div>coverage</div>" }, update: ["name", "renamed-NAME", "name"], find: `(app, n) => app.defaultAccount().folders.byName("${T}").notes().filter((x) => x.name().indexOf(n) >= 0)` },
  },
  {
    app: "Calendar",
    sensitive: true,
    setup: `(app) => { if (!app.calendars.whose({ name: "${T}" }).length) app.calendars.push(app.Calendar({ name: "${T}" })); }`,
    teardown: `(app) => { app.calendars.whose({ name: "${T}" })().forEach((c) => app.delete(c)); }`,
    scope: [`calendars[name="${T}"]`],
    roundTrip: { cls: "event", parent: `calendars[name="${T}"]`, create: { summary: "NAME", "start date": "2026-12-01T10:00:00", "end date": "2026-12-01T11:00:00" }, update: ["location", "Room 4", "location"], find: `(app, n) => app.calendars.byName("${T}").events.whose({ summary: n })()` },
  },
  {
    app: "Contacts",
    sensitive: true,
    setup: `(app) => { if (!app.groups.whose({ name: "${T}" }).length) { app.groups.push(app.Group({ name: "${T}" })); app.save(); } }`,
    teardown: `(app) => { app.groups.whose({ name: "${T}" })().forEach((g) => app.delete(g)); app.save(); }`,
    // People live at the top level (a group only lists them), so writes are not scoped; the round trip deletes only its own person.
    sweep: [`groups[name="${T}"]`],
    roundTrip: { cls: "person", create: { "first name": "NAME", "last name": "Testperson" }, update: ["organization", "mcpify", "organization"], find: `(app, n) => app.people.whose({ firstName: n })()` },
  },
  {
    app: "Music",
    roundTrip: { cls: "user playlist", parent: `sources[name="Library"]`, create: { name: "NAME" }, update: ["description", "coverage run", "description"], find: `(app, n) => app.userPlaylists.whose({ name: n })()` },
  },
  {
    app: "Finder",
    setup: `(app) => { if (!app.home().folders.whose({ name: "${T}" }).length) app.make({ new: "folder", at: app.home(), withProperties: { name: "${T}" } }); }`,
    teardown: () => rmSync(join(homedir(), T), { recursive: true, force: true }),
    scope: [HOME_REF],
    roundTrip: { cls: "folder", parent: HOME_REF, create: { name: "NAME" }, update: ["comment", "coverage run", "comment"], find: `(app, n) => app.home().folders.byName("${T}").folders.whose({ name: n })()` },
  },
  {
    app: "TextEdit",
    roundTrip: { cls: "document", create: { text: "NAME" }, update: ["text", "edited NAME", "text"], find: `(app, n) => app.documents().filter((d) => String(d.text()).indexOf(n) >= 0)` },
  },
  {
    app: "Keynote",
    // A fresh untitled document; its name fills {doc} below. Closed without saving afterwards.
    setup: `(app) => { const d = app.Document(); app.documents.push(d); return app.documents[0].name(); }`,
    teardown: `(app) => { app.documents().forEach((d) => { if (d.name().indexOf("Untitled") === 0) d.close({ saving: "no" }); }); }`,
    scope: [`documents[name="{doc}"]`],
    roundTrip: { cls: "slide", parent: `documents[name="{doc}"]`, create: { skipped: false }, update: ["skipped", true, "skipped"], find: `(app) => app.documents[0].slides()` },
  },
  {
    app: "Numbers",
    // A fresh untitled document; its name fills {doc} below. Closed without saving afterwards.
    setup: `(app) => { const d = app.Document(); app.documents.push(d); return app.documents[0].name(); }`,
    teardown: `(app) => { app.documents().forEach((d) => { if (d.name().indexOf("Untitled") === 0) d.close({ saving: "no" }); }); }`,
    scope: [`documents[name="{doc}"]`],
    roundTrip: { cls: "sheet", parent: `documents[name="{doc}"]`, create: { name: "NAME" }, update: ["name", "renamed-NAME", "name"], find: `(app) => app.documents[0].sheets()` },
  },
  {
    app: "Pages",
    // A fresh untitled document; its name fills {doc} below. Closed without saving afterwards.
    setup: `(app) => { const d = app.Document(); app.documents.push(d); return app.documents[0].name(); }`,
    teardown: `(app) => { app.documents().forEach((d) => { if (d.name().indexOf("Untitled") === 0) d.close({ saving: "no" }); }); }`,
    scope: [`documents[name="{doc}"]`],
  },
  {
    app: "Photos",
    sensitive: true,
    why: "dictionary marks every element read only, so mcpify generates no create tools",
  },
  {
    app: "Safari",
    roundTrip: { cls: "document", create: { URL: "about:blank#NAME" }, update: ["URL", "about:blank#edited-NAME", "URL"], find: `(app, n) => app.documents().filter((d) => String(d.url()).indexOf(n) >= 0)` },
  },
  { app: "Mail", sensitive: true, why: "read only by design here; the sweep reads no messages" },
];
