# Agent demo: Claude Code using mcpify-notes

Prompt: Use the Apple Notes tools, read only. Find my note containing 'zebra1792560502', read it, and tell me in one short sentence what is left on the list. Do not open any other note.

MCP servers: [{"name":"notes","status":"connected","source":"dynamic"}]
Notes tools offered: mcp__notes__create_note, mcp__notes__list_folders, mcp__notes__list_notes, mcp__notes__read_note, mcp__notes__search_notes, mcp__notes__update_note

**agent calls** `mcp__notes__search_notes` `{"query":"zebra1792560589"}`

```json
Command failed: osascript -l JavaScript -e function run(argv) {
  const app = Application("Notes");
  const args = JSON.parse(argv[0]);
  const out = ((app, args) => { 
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toHtml(text) {
    return String(text).split("\n").map(function (l) { return "<div>" + (l.length ? esc(l) : "<br>") + "</div>"; }).join("");
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
        return { total: all.length, notes: hits }; })(app, args);
  return JSON.stringify(out === undefined ? null : out);
} {"query":"zebra1792560589","limit":20}
```

**agent calls** `mcp__notes__search_notes` `{"query":"zebra1792560589"}`

```json
Command failed: osascript -l JavaScript -e function run(argv) {
  const app = Application("Notes");
  const args = JSON.parse(argv[0]);
  const out = ((app, args) => { 
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function toHtml(text) {
    return String(text).split("\n").map(function (l) { return "<div>" + (l.length ? esc(l) : "<br>") + "</div>"; }).join("");
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
        return { total: all.length, notes: hits }; })(app, args);
  return JSON.stringify(out === undefined ? null : out);
} {"query":"zebra1792560589","limit":20}
```

**agent says:** I couldn't find or read the note. The Notes search failed twice with the same `osascript` error, and the output didn't say why. I don't know what's left on your list.

I stopped there. I didn't open any other note or try another route to the note. You could check that the Notes app is running and that automation access is allowed for it. I can retry after that.

Run: 4 turns, 131.0 s.
