// The agent task suite: realistic one-line requests across ten apps. Each task seeds its own test data
// with raw osascript, and is graded by raw osascript reads of the app afterwards (or by the answer text),
// never by mcpify. All data lives in containers named mcpify-test.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { HOME_REF } from "./fixtures.ts";

const [osaCmd, ...osaPre] = (process.env.MCPIFY_OSASCRIPT || "osascript").split(/\s+/);
export function osa<T = unknown>(app: string, fn: string, args: unknown = {}): T {
  const script = `function run(argv){const app=Application(${JSON.stringify(app)});const a=JSON.parse(argv[0]);const r=(${fn})(app,a);return JSON.stringify(r===undefined?null:r);}`;
  return JSON.parse(execFileSync(osaCmd, [...osaPre, "-l", "JavaScript", "-e", script, JSON.stringify(args)], { encoding: "utf8", timeout: 240_000 }));
}

export interface Task {
  id: string;
  app: string;
  prompt: string;
  /** Seeds the test container; may return values to fill {placeholders} in the prompt. */
  setup: () => Record<string, string> | void;
  /** Grades the run from the app's state and the final answer. */
  check: (answer: string, vars: Record<string, string>) => boolean;
  /** Write tools the mcpify arm needs: none (read task), writes, or writes plus deletes. */
  needs: "read" | "write" | "delete";
  /** --scope for the mcpify arm. */
  scope?: string[];
}

const T = "mcpify-test";
const has = (answer: string, ...words: (string | number)[]) => words.every((w) => answer.toLowerCase().includes(String(w).toLowerCase()));
const num = (answer: string, n: number) => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(answer);
const iso = (s: string) => `new Date(${JSON.stringify(s)})`;

// Reminders: a list named mcpify-test, emptied before each task.
const REM = `(app)=>{let l=app.lists.whose({name:"${T}"});if(!l.length)app.lists.push(app.List({name:"${T}"}));l=app.lists.byName("${T}");l.reminders().forEach(r=>app.delete(r));return l}`;
const rem = (seed: string) => () => void osa("Reminders", `(app)=>{const l=(${REM})(app);${seed}}`);
const remGet = <T>(body: string) => osa<T>("Reminders", `(app)=>{const l=app.lists.byName("${T}");${body}}`);

// Notes: a folder named mcpify-test in the default account, emptied before each task.
const NOTES = `(app)=>{const a=app.defaultAccount();if(!a.folders.whose({name:"${T}"}).length)a.folders.push(app.Folder({name:"${T}"}));const f=a.folders.byName("${T}");f.notes().forEach(n=>app.delete(n));return f}`;
const note = (title: string, lines: string[]) => `f.notes.push(app.Note({body:${JSON.stringify(`<div><h1>${title}</h1></div>${lines.map((l) => `<div>${l}</div>`).join("")}`)}}));`;
const notesGet = <T>(body: string) => osa<T>("Notes", `(app)=>{const f=app.defaultAccount().folders.byName("${T}");${body}}`);

// Calendar: a calendar named mcpify-test, emptied before each task.
const CAL = `(app)=>{if(!app.calendars.whose({name:"${T}"}).length)app.calendars.push(app.Calendar({name:"${T}"}));const c=app.calendars.byName("${T}");c.events().forEach(e=>app.delete(e));return c}`;
const ev = (summary: string, start: string, end: string, extra = "") => `c.events.push(app.Event({summary:${JSON.stringify(summary)},startDate:${iso(start)},endDate:${iso(end)}${extra}}));`;
const calGet = <T>(body: string) => osa<T>("Calendar", `(app)=>{const c=app.calendars.byName("${T}");${body}}`);

// Contacts: a group named mcpify-test; test people have the last name Testperson.
const CON = `(app)=>{app.people.whose({lastName:"Testperson"})().forEach(p=>app.delete(p));if(!app.groups.whose({name:"${T}"}).length)app.groups.push(app.Group({name:"${T}"}));app.save();return app.groups.byName("${T}")}`;
const person = (first: string, extra = "") => `{const p=app.Person({firstName:${JSON.stringify(first)},lastName:"Testperson"${extra}});app.people.push(p);app.save();app.add(app.people.whose({firstName:${JSON.stringify(first)},lastName:"Testperson"})[0],{to:g});app.save();}`;

// Music: user playlists whose names start with mcpify.
const MUS = `(app)=>{app.userPlaylists.whose({name:{_beginsWith:"mcpify"}})().forEach(p=>app.delete(p))}`;

// Finder: a folder at ~/mcpify-test, rebuilt before each task.
const DIR = join(homedir(), T);
const finder = (files: string[]) => () => {
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR);
  for (const f of files) writeFileSync(`${DIR}/${f}`, `test file ${f}\n`);
};
const FINDER_SCOPE = [HOME_REF];

// TextEdit and Keynote: documents opened for the task, closed without saving afterwards (see cleanup in agent.ts).
const TE_CLOSE = `(app)=>{app.documents().forEach(d=>{try{if(String(d.text()).indexOf("${T}")>=0)d.close({saving:"no"})}catch(e){}})}`;
const KN_CLOSE = `(app)=>{app.documents().forEach(d=>{try{if(d.name().indexOf("${T}")>=0||d.name().indexOf("Untitled")===0)d.close({saving:"no"})}catch(e){}})}`;

export const CLEANUP: Record<string, () => void> = {
  Reminders: () => void osa("Reminders", `(app)=>{app.lists.whose({name:"${T}"})().forEach(l=>app.delete(l))}`),
  Notes: () => void osa("Notes", `(app)=>{const f=app.defaultAccount().folders.whose({name:"${T}"});if(f.length)f[0].notes().forEach(n=>app.delete(n))}`),
  Calendar: () => void osa("Calendar", `(app)=>{app.calendars.whose({name:"${T}"})().forEach(c=>app.delete(c))}`),
  Contacts: () => void osa("Contacts", `(app)=>{app.people.whose({lastName:"Testperson"})().forEach(p=>app.delete(p));app.groups.whose({name:"${T}"})().forEach(g=>app.delete(g));app.save()}`),
  Music: () => void osa("Music", MUS),
  Finder: () => rmSync(DIR, { recursive: true, force: true }),
  TextEdit: () => void osa("TextEdit", TE_CLOSE),
  Keynote: () => void osa("Keynote", KN_CLOSE),
};

/** Counts of everything outside the test containers, compared before and after each run to catch collateral writes. */
export const FINGERPRINT: Record<string, () => unknown> = {
  Reminders: () => osa("Reminders", `(app)=>app.lists().filter(l=>l.name()!=="${T}").map(l=>l.reminders.length)`),
  Notes: () => osa("Notes", `(app)=>app.folders().filter(f=>f.name()!=="${T}").map(f=>f.notes.length)`),
  Calendar: () => osa("Calendar", `(app)=>app.calendars.name().filter(n=>n!=="${T}").length`),
  Contacts: () => osa("Contacts", `(app)=>[app.people.length-app.people.whose({lastName:"Testperson"}).length,app.groups.length-app.groups.whose({name:"${T}"}).length]`),
  Music: () => osa("Music", `(app)=>app.userPlaylists.name().filter(n=>n.indexOf("mcpify")!==0).length`),
  Finder: () => readdirSync(homedir()).filter((f) => f !== T).length,
};

export const TASKS: Task[] = [
  // Reminders
  { id: "rem-count-open", app: "Reminders", needs: "read", prompt: `How many reminders in my Reminders list "${T}" are not completed yet? Answer with the number.`,
    setup: rem(["Water plants", "Pay rent", "Email Sam", "Book flights", "Return parcel"].map((n, i) => `l.reminders.push(app.Reminder({name:"${n}",completed:${i < 2}}));`).join("")),
    check: (a) => num(a, 3) },
  { id: "rem-add-due", app: "Reminders", needs: "write", scope: [`lists[name="${T}"]`], prompt: `Add a reminder "Buy batteries" to my "${T}" list in Reminders, due November 20, 2026 at 9:00 AM.`,
    setup: rem(""), check: () => remGet<boolean>(`const r=l.reminders.whose({name:"Buy batteries"})();if(r.length!==1)return false;const d=r[0].dueDate();return !!d&&d.getMonth()===10&&d.getDate()===20&&d.getHours()===9`) },
  { id: "rem-complete", app: "Reminders", needs: "write", scope: [`lists[name="${T}"]`], prompt: `In Reminders, mark "Call plumber" in my "${T}" list as done.`,
    setup: rem(`l.reminders.push(app.Reminder({name:"Call plumber"}));l.reminders.push(app.Reminder({name:"Call electrician"}));`),
    check: () => remGet<boolean>(`return l.reminders.byName("Call plumber").completed()===true&&l.reminders.byName("Call electrician").completed()===false`) },
  { id: "rem-priority", app: "Reminders", needs: "read", prompt: `Which reminder in my Reminders list "${T}" is marked high priority? Reply with just its name.`,
    setup: rem(`l.reminders.push(app.Reminder({name:"Sort recycling",priority:9}));l.reminders.push(app.Reminder({name:"Submit tax form",priority:1}));l.reminders.push(app.Reminder({name:"Buy stamps"}));`),
    check: (a) => has(a, "Submit tax form") && !has(a, "Sort recycling") },
  { id: "rem-push-due", app: "Reminders", needs: "write", scope: [`lists[name="${T}"]`], prompt: `Push the due date of "Renew passport" in my Reminders list "${T}" back by exactly one week, keeping the time.`,
    setup: rem(`l.reminders.push(app.Reminder({name:"Renew passport",dueDate:${iso("2026-12-01T10:30:00")}}));`),
    check: () => remGet<boolean>(`const d=l.reminders.byName("Renew passport").dueDate();return d.getMonth()===11&&d.getDate()===8&&d.getHours()===10&&d.getMinutes()===30`) },
  { id: "rem-delete", app: "Reminders", needs: "delete", scope: [`lists[name="${T}"]`], prompt: `Delete the reminder "Old task" from my Reminders list "${T}". Leave the others alone.`,
    setup: rem(`l.reminders.push(app.Reminder({name:"Old task"}));l.reminders.push(app.Reminder({name:"New task"}));`),
    check: () => remGet<boolean>(`return l.reminders.whose({name:"Old task"}).length===0&&l.reminders.whose({name:"New task"}).length===1`) },

  // Notes
  { id: "notes-find-secret", app: "Notes", needs: "read", prompt: `In my Notes folder "${T}" there's a note called "Wifi details". What's the wifi password in it? Reply with just the password.`,
    setup: () => void osa("Notes", `(app)=>{const f=(${NOTES})(app);${note("Wifi details", ["network: mcpify-guest", "password: plum-orbit-42"])}${note("Router", ["admin page 192.168.1.1"])}}`),
    check: (a) => has(a, "plum-orbit-42") },
  { id: "notes-create", app: "Notes", needs: "write", scope: [`folders[name="${T}"]`], prompt: `Create a note titled "Packing list" in my Notes folder "${T}" with three lines: socks, charger, passport.`,
    setup: () => void osa("Notes", `(app)=>{(${NOTES})(app)}`),
    check: () => notesGet<boolean>(`const n=f.notes().filter(x=>x.name().indexOf("Packing list")===0);if(n.length!==1)return false;const t=n[0].plaintext().toLowerCase();return ["socks","charger","passport"].every(w=>t.indexOf(w)>=0)`) },
  { id: "notes-count", app: "Notes", needs: "read", prompt: `How many notes are in my Notes folder "${T}"? Answer with the number.`,
    setup: () => void osa("Notes", `(app)=>{const f=(${NOTES})(app);${note("Alpha", ["a"])}${note("Beta", ["b"])}${note("Gamma", ["c"])}${note("Delta", ["d"])}}`),
    check: (a) => num(a, 4) },
  { id: "notes-append", app: "Notes", needs: "write", scope: [`folders[name="${T}"]`], prompt: `Add "toothbrush" as a new line at the end of the note "Packing list" in my Notes folder "${T}". Keep what's already there.`,
    setup: () => void osa("Notes", `(app)=>{const f=(${NOTES})(app);${note("Packing list", ["socks", "charger"])}}`),
    check: () => notesGet<boolean>(`const n=f.notes().filter(x=>x.name().indexOf("Packing list")===0);if(n.length!==1)return false;const t=n[0].plaintext().toLowerCase();return ["socks","charger","toothbrush"].every(w=>t.indexOf(w)>=0)`) },

  // Calendar
  { id: "cal-create", app: "Calendar", needs: "write", scope: [`calendars[name="${T}"]`], prompt: `Add an event "Dentist" to my calendar "${T}" on December 3, 2026 from 2:00 PM to 3:00 PM.`,
    setup: () => void osa("Calendar", `(app)=>{(${CAL})(app)}`),
    check: () => calGet<boolean>(`const e=c.events.whose({summary:"Dentist"})();if(e.length!==1)return false;const s=e[0].startDate(),t=e[0].endDate();return s.getMonth()===11&&s.getDate()===3&&s.getHours()===14&&t.getHours()===15&&t.getMinutes()===0`) },
  { id: "cal-start-time", app: "Calendar", needs: "read", prompt: `What time does "Team lunch" start on my calendar "${T}"? Answer in 24-hour HH:MM.`,
    setup: () => void osa("Calendar", `(app)=>{const c=(${CAL})(app);${ev("Team lunch", "2026-12-02T12:15:00", "2026-12-02T13:00:00")}${ev("Design review", "2026-12-02T15:00:00", "2026-12-02T16:00:00")}}`),
    check: (a) => has(a, "12:15") },
  { id: "cal-week-count", app: "Calendar", needs: "read", prompt: `How many events are on my calendar "${T}" during the week of Monday December 7 to Sunday December 13, 2026? Answer with the number.`,
    setup: () => void osa("Calendar", `(app)=>{const c=(${CAL})(app);${ev("A", "2026-12-08T09:00:00", "2026-12-08T10:00:00")}${ev("B", "2026-12-10T09:00:00", "2026-12-10T10:00:00")}${ev("C", "2026-12-12T18:00:00", "2026-12-12T19:00:00")}${ev("D", "2026-12-15T09:00:00", "2026-12-15T10:00:00")}${ev("E", "2026-12-04T09:00:00", "2026-12-04T10:00:00")}}`),
    check: (a) => num(a, 3) },
  { id: "cal-move", app: "Calendar", needs: "write", scope: [`calendars[name="${T}"]`], prompt: `Move "Standup" on my calendar "${T}" (December 4, 2026) to start at 10:00 AM, keeping its 15-minute length.`,
    setup: () => void osa("Calendar", `(app)=>{const c=(${CAL})(app);${ev("Standup", "2026-12-04T09:00:00", "2026-12-04T09:15:00")}}`),
    check: () => calGet<boolean>(`const e=c.events.whose({summary:"Standup"})()[0];const s=e.startDate(),t=e.endDate();return s.getDate()===4&&s.getHours()===10&&s.getMinutes()===0&&t.getHours()===10&&t.getMinutes()===15`) },
  { id: "cal-location", app: "Calendar", needs: "write", scope: [`calendars[name="${T}"]`], prompt: `Set the location of "Board review" on my calendar "${T}" to "Room 12".`,
    setup: () => void osa("Calendar", `(app)=>{const c=(${CAL})(app);${ev("Board review", "2026-12-09T13:00:00", "2026-12-09T14:00:00")}${ev("Offsite", "2026-12-10T13:00:00", "2026-12-10T14:00:00")}}`),
    check: () => calGet<boolean>(`return c.events.whose({summary:"Board review"})()[0].location()==="Room 12"&&!c.events.whose({summary:"Offsite"})()[0].location()`) },

  // Contacts
  { id: "contacts-org", app: "Contacts", needs: "read", prompt: `Which company does Zed Testperson work for? They're in my Contacts group "${T}". Reply with the company name.`,
    setup: () => void osa("Contacts", `(app)=>{const g=(${CON})(app);${person("Zed", `,organization:"Quillfeather Labs"`)}${person("Amy", `,organization:"Other Co"`)}}`),
    check: (a) => has(a, "Quillfeather") },
  { id: "contacts-title", app: "Contacts", needs: "write", prompt: `Set the job title of Zed Testperson (Contacts group "${T}") to "QA Lead".`,
    setup: () => void osa("Contacts", `(app)=>{const g=(${CON})(app);${person("Zed")}}`),
    check: () => osa<boolean>("Contacts", `(app)=>app.people.whose({firstName:"Zed",lastName:"Testperson"})()[0].jobTitle()==="QA Lead"`) },
  { id: "contacts-count", app: "Contacts", needs: "read", prompt: `How many people are in my Contacts group "${T}"? Answer with the number.`,
    setup: () => void osa("Contacts", `(app)=>{const g=(${CON})(app);${person("Ann")}${person("Ben")}${person("Cal")}}`),
    check: (a) => num(a, 3) },

  // Music
  { id: "music-create", app: "Music", needs: "write", prompt: `Create an empty playlist in Music called "mcpify focus".`,
    setup: () => void osa("Music", MUS), check: () => osa<number>("Music", `(app)=>app.userPlaylists.whose({name:"mcpify focus"}).length`) === 1 },
  { id: "music-rename", app: "Music", needs: "write", prompt: `In Music, rename my playlist "mcpify old" to "mcpify new" and set its description to "evening".`,
    setup: () => void osa("Music", `(app)=>{(${MUS})(app);app.make({new:"userPlaylist",withProperties:{name:"mcpify old"}})}`),
    check: () => osa<boolean>("Music", `(app)=>{const p=app.userPlaylists.whose({name:"mcpify new"})();return p.length===1&&p[0].description()==="evening"&&app.userPlaylists.whose({name:"mcpify old"}).length===0}`) },
  { id: "music-volume", app: "Music", needs: "read", prompt: `What is the Music app's sound volume set to right now? Answer with the number.`,
    setup: () => {}, check: (a) => num(a, osa<number>("Music", `(app)=>app.soundVolume()`)) },

  // Finder
  { id: "finder-count-md", app: "Finder", needs: "read", prompt: `Using Finder, how many .md files are in the folder ${DIR}? Answer with the number.`,
    setup: finder(["a.txt", "b.txt", "c.txt", "notes.md", "plan.md", "readme.md", "todo.txt"]), check: (a) => num(a, 3) },
  { id: "finder-new-folder", app: "Finder", needs: "write", scope: FINDER_SCOPE, prompt: `Using Finder, create a folder named "archive" inside ${DIR}.`,
    setup: finder(["a.txt"]), check: () => existsSync(`${DIR}/archive`) && existsSync(`${DIR}/a.txt`) },
  { id: "finder-rename", app: "Finder", needs: "write", scope: FINDER_SCOPE, prompt: `Using Finder, rename draft.txt in ${DIR} to final.txt.`,
    setup: finder(["draft.txt", "other.txt"]), check: () => existsSync(`${DIR}/final.txt`) && !existsSync(`${DIR}/draft.txt`) && existsSync(`${DIR}/other.txt`) },
  { id: "finder-comment", app: "Finder", needs: "write", scope: FINDER_SCOPE, prompt: `Using Finder, set the Finder comment of report.txt in ${DIR} to "reviewed".`,
    setup: finder(["report.txt"]), check: () => osa<string>("Finder", `(app)=>app.home().folders.byName("${T}").files.byName("report.txt").comment()`) === "reviewed" },
  { id: "finder-largest", app: "Finder", needs: "read", prompt: `Using Finder, which file in ${DIR} is the largest? Reply with its file name.`,
    setup: () => { finder(["small.txt", "medium.txt"])(); writeFileSync(`${DIR}/big.log`, "x".repeat(50_000)); }, check: (a) => has(a, "big.log") },

  // TextEdit
  { id: "textedit-new", app: "TextEdit", needs: "write", prompt: `Open a new TextEdit document whose text is exactly: hello from ${T}`,
    setup: () => void osa("TextEdit", TE_CLOSE), check: () => osa<number>("TextEdit", `(app)=>app.documents().filter(d=>String(d.text()).trim()==="hello from ${T}").length`) === 1 },
  { id: "textedit-read", app: "TextEdit", needs: "read", prompt: `One of my open TextEdit documents mentions "${T}". What is the magic number written in it? Reply with the number.`,
    setup: () => void osa("TextEdit", `(app)=>{(${TE_CLOSE})(app);app.documents.push(app.Document({text:"${T}: the magic number is 4817."}))}`), check: (a) => num(a, 4817) },

  // Keynote
  { id: "keynote-count", app: "Keynote", needs: "read", prompt: `How many slides does the open Keynote presentation "{doc}" have? Answer with the number.`,
    setup: () => ({ doc: osa<string>("Keynote", `(app)=>{(${KN_CLOSE})(app);const d=app.Document();app.documents.push(d);const k=app.documents[0];k.slides.push(app.Slide());k.slides.push(app.Slide());k.slides.push(app.Slide());return k.name()}`) }),
    check: (a) => num(a, 4) },
  { id: "keynote-add", app: "Keynote", needs: "write", prompt: `Add one new slide to the end of the open Keynote presentation "{doc}".`,
    setup: () => ({ doc: osa<string>("Keynote", `(app)=>{(${KN_CLOSE})(app);const d=app.Document();app.documents.push(d);return app.documents[0].name()}`) }),
    check: (_a, v) => osa<number>("Keynote", `(app,a)=>app.documents.byName(a.doc).slides.length`, v) === 2 },

  // Mail (read only, structure only: no message is read)
  { id: "mail-accounts", app: "Mail", needs: "read", prompt: `How many accounts are set up in the Mail app? Answer with the number. Don't open or read any messages.`,
    setup: () => {}, check: (a) => num(a, osa<number>("Mail", `(app)=>app.accounts.length`)) },
];
