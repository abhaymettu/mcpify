# Agent demo: Claude Code using mcpify-notes

Prompt: Use the Apple Notes tools, read only. Find my note containing 'zebra1792563667', read it, and tell me in one short sentence what is left on the list. Do not open any other note.

MCP servers: [{"name":"notes","status":"connected","source":"dynamic"}]
Notes tools offered: mcp__notes__create_note, mcp__notes__list_folders, mcp__notes__list_notes, mcp__notes__read_note, mcp__notes__search_notes, mcp__notes__update_note

**agent calls** `mcp__notes__search_notes` `{"query":"zebra1792563667"}`

```json
{"result":{"total":1,"notes":[{"id":"x-coredata://<store>/ICNote/p754","name":"Saturday errands zebra1792563667","modified":"2026-10-21T06:21:09.000Z","snippet":"Saturday errands zebra1792563667\npick up dry cleaning\nbuy birthday card\nreturn library books"}]}}
```

**agent calls** `mcp__notes__read_note` `{"id":"x-coredata://<store>/ICNote/p754"}`

```json
{"result":{"id":"x-coredata://<store>/ICNote/p754","name":"Saturday errands zebra1792563667","folder":"mcpify-test","folder_id":"x-coredata://<store>/ICFolder/p735","created":"2026-10-21T06:21:09.000Z","modified":"2026-10-21T06:21:09.000Z","locked":false,"attachments":0,"text":"Saturday errands zebra1792563667\npick up dry cleaning\nbuy birthday card\nreturn library books\ncall grandma\n","html":"<div><b><span style=\"font-size: 24px\">Saturday errands zebra1792563667</span></b></div>\n<div>pick up dry cleaning</div>\n<div>buy birthday card</div>\n<div>return library books</div>\n<div>call grandma</div>\n"}}
```

**agent says:** All four errands in "Saturday errands" are still on the list: pick up dry cleaning, buy a birthday card, return library books, and call grandma (none are checked off or crossed out).

Run: 4 turns, 16.1 s.
