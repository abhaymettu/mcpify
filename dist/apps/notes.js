import { z } from "zod";
// Shared JXA helpers, pasted into each tool body (each tool runs in its own osascript).
const HELPERS = `
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toHtml(text) {
    return String(text).split("\\n").map(function (l) { return "<div>" + (l.length ? esc(l) : "<br>") + "</div>"; }).join("");
  }
  function noteById(id) {
    const n = app.notes.byId(id);
    try { n.name(); } catch (e) { throw new Error("no note with id " + id); }
    return n;
  }
  function folderById(id) {
    const f = app.folders.byId(id);
    try { f.name(); } catch (e) { throw new Error("no folder with id " + id); }
    return f;
  }
  function rows(spec) {
    const ids = spec.id(), names = spec.name(), mods = spec.modificationDate();
    return ids.map(function (id, i) { return { id: id, name: names[i], modified: mods[i] }; })
      .sort(function (a, b) { return b.modified - a.modified; });
  }
`;
const body = (code) => `(app, args) => { ${HELPERS} ${code} }`;
const noteId = z.string().describe("Note id from list_notes or search_notes (x-coredata://...)");
export const notes = {
    app: "Notes",
    server: "mcpify-notes",
    tools: [
        {
            name: "list_folders",
            description: "List every Notes folder across all accounts, with its id, account and note count.",
            input: {},
            writes: false,
            jxa: body(`
        const out = [];
        app.accounts().forEach(function (acc) {
          // One bulk Apple Event per account; asking each folder for its count separately is slow enough to time out.
          const fs = acc.folders, ids = fs.id(), names = fs.name(), counts = fs.notes.id(), accName = acc.name();
          for (let i = 0; i < ids.length; i++) {
            out.push({ id: ids[i], name: names[i], account: accName, note_count: counts[i].length });
          }
        });
        return out;`),
        },
        {
            name: "list_notes",
            description: "List notes, newest first. Optionally limit to one folder.",
            input: {
                folder_id: z.string().optional().describe("Folder id from list_folders; omit for all notes"),
                limit: z.number().int().min(1).max(500).default(50),
            },
            writes: false,
            jxa: body(`
        const spec = args.folder_id ? folderById(args.folder_id).notes : app.notes;
        const limit = args.limit || 50;
        const all = rows(spec);
        return { total: all.length, notes: all.slice(0, limit) };`),
        },
        {
            name: "search_notes",
            description: "Find notes whose title or text contains the query (matched inside Notes). Returns newest first with a snippet.",
            input: {
                query: z.string().min(1),
                limit: z.number().int().min(1).max(100).default(20),
            },
            writes: false,
            jxa: body(`
        const q = args.query, limit = args.limit || 20;
        const spec = app.notes.whose({ _or: [{ name: { _contains: q } }, { plaintext: { _contains: q } }] });
        const all = rows(spec);
        const ql = q.toLowerCase();
        const hits = all.slice(0, limit).map(function (r) {
          const text = noteById(r.id).plaintext();
          const at = text.toLowerCase().indexOf(ql);
          const start = Math.max(0, at - 60);
          r.snippet = at < 0 ? text.slice(0, 120) : (start > 0 ? "..." : "") + text.slice(start, at + q.length + 60);
          return r;
        });
        return { total: all.length, notes: hits };`),
        },
        {
            name: "read_note",
            description: "Read one note: title, folder, dates, plain text and HTML body. Locked notes return metadata only.",
            input: { id: noteId },
            writes: false,
            jxa: body(`
        const n = noteById(args.id), f = n.container();
        const meta = { id: n.id(), name: n.name(), folder: f.name(), folder_id: f.id(),
          created: n.creationDate(), modified: n.modificationDate(),
          locked: n.passwordProtected(), attachments: n.attachments.length };
        if (meta.locked) return meta;
        meta.text = n.plaintext();
        meta.html = n.body();
        return meta;`),
        },
        {
            name: "create_note",
            description: "Create a note with a title and plain-text body. Goes to the default folder unless folder_id is given.",
            input: {
                title: z.string().min(1),
                body: z.string().default(""),
                folder_id: z.string().optional().describe("Folder id from list_folders"),
            },
            writes: true,
            jxa: body(`
        const folder = args.folder_id ? folderById(args.folder_id) : app.defaultAccount().defaultFolder();
        const html = "<div><h1>" + esc(args.title) + "</h1></div>" + (args.body ? toHtml(args.body) : "");
        const n = app.Note({ body: html });
        folder.notes.push(n);
        return { id: n.id(), name: n.name(), folder: folder.name(), folder_id: folder.id() };`),
        },
        {
            name: "update_note",
            description: "Append plain text to a note, or replace its body (keeping or changing the title). Refuses locked notes and notes with attachments, because rewriting their body can drop the attachments.",
            input: {
                id: noteId,
                text: z.string(),
                mode: z.enum(["append", "replace"]).default("append"),
                title: z.string().min(1).optional().describe("New title; only used with mode=replace"),
            },
            writes: true,
            jxa: body(`
        const n = noteById(args.id);
        if (n.passwordProtected()) throw new Error("note is locked; mcpify does not edit locked notes");
        if (n.attachments.length > 0) throw new Error("note has attachments; mcpify v0 refuses to rewrite it so they are not lost");
        const mode = args.mode || "append";
        if (mode === "append") {
          n.body = n.body() + toHtml(args.text);
        } else {
          const title = args.title || n.name();
          n.body = "<div><h1>" + esc(title) + "</h1></div>" + toHtml(args.text);
        }
        return { id: n.id(), name: n.name(), modified: n.modificationDate(), mode: mode };`),
        },
    ],
};
