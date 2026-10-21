# mcpify

Turn a closed Mac app into an MCP server that an AI agent can use.

v0 does this for one app, Apple Notes, in two ways:

1. **`mcpify serve notes`**: a hand-written server with six tools (list folders, list notes, search, read, create, update). Tested end to end against the real Notes app.
2. **`mcpify generate <App.app>`**: a read-only server built only from the app's scripting dictionary, with no app-specific code. For Notes it produces eight tools (list and get for accounts, folders, notes and attachments). Tested against the real Notes app. **Not yet tried on any other app** (see Limits).

Plus **`mcpify inspect <App.app>`**, which prints what an app exposes to scripting, or says it has no dictionary.

The goal is "any closed Mac app becomes an MCP server". v0 shows the path for apps that ship a scripting dictionary, and proves it on one of them. It does not claim more than that.

## Quick start

Needs macOS and Node 23.6 or newer (TypeScript runs directly, no build step).

```sh
git clone https://github.com/abhaymettu/mcpify && cd mcpify
npm install
node src/cli.ts inspect /System/Applications/Notes.app   # what Notes exposes
npm test                                                  # drives the real Notes app
```

The first call asks macOS for permission to control Notes (System Settings > Privacy & Security > Automation). Grant it to the terminal or agent that runs mcpify.

Use it from Claude Code with an MCP config file (this is the form used for the agent demo, Claude Code 2.1.303):

```json
{ "mcpServers": { "notes": { "command": "node", "args": ["/path/to/mcpify/src/cli.ts", "serve", "notes"] } } }
```

```sh
claude -p "Find my note about rain jackets" --mcp-config notes.json --allowedTools "mcp__notes__search_notes,mcp__notes__read_note"
```

The server speaks MCP over stdio. It was tested with the official MCP TypeScript client (1.32) and Claude Code. Other clients should work the same way but were not tried.

## Tools (`serve notes`)

| Tool | Writes | What it does |
|---|---|---|
| `list_folders` | no | Every folder in every account, with id and note count |
| `list_notes` | no | Notes newest first, optionally in one folder |
| `search_notes` | no | Title or text contains the query (matched inside Notes, case insensitive), with a snippet |
| `read_note` | no | Title, folder, dates, plain text and HTML. Locked notes return metadata only |
| `create_note` | yes | New note from a title and plain text, in the default folder or a given one |
| `update_note` | yes | Append text, or replace the body (optionally the title). Refuses locked notes and notes with attachments |

There is no delete tool, on purpose.

## How it works

Each tool is a small JavaScript for Automation (JXA) function that runs inside `osascript` and talks to the app over Apple Events. Arguments go in as one JSON string, never pasted into the script, so text from the agent cannot become code. Text the agent writes is HTML-escaped before it reaches Notes, so it stays text.

`generate` reads the dictionary with `sdef`, finds the classes the application object contains, and makes a `list_<plural>` and a `get_<class>` tool for each, reading every property with a simple type (text, number, boolean, date).

## Tests

`npm test` runs three files:

- `test/notes.e2e.test.ts`: starts `mcpify serve notes`, connects the official MCP client over stdio, and calls every tool against the real Notes app. Each result is checked with a separate raw `osascript` read that does not use mcpify code. No mocks.
- `test/generated.e2e.test.ts`: the same for `mcpify generate /System/Applications/Notes.app`.
- `test/inspect.test.ts`: the dictionary reader on Notes (scriptable) and Calculator (not scriptable).

The tests work inside one folder named `mcpify-test` in the default account. They create it if needed, and delete the notes they make (deleted notes go to Notes' Recently Deleted). They never read or change other notes, except that search runs across all notes for a random token that only the test note contains.

Results are in [Test evidence](#test-evidence).

## Limits

- **Notes can stall.** Notes answers Apple Events on its main thread, which also redraws the sidebar from its database. On a machine with heavy disk load, single calls took 8 to 81 seconds, and some hit Apple's 2 minute Apple Event timeout. On a quiet machine the same calls took about 0.15 to 2.5 seconds. Once, Notes stayed slow until it was quit and relaunched. mcpify waits up to 120 s (`MCPIFY_TIMEOUT_MS` to change it), then returns a clear error.
- **A write that times out may still happen.** The request stays queued inside Notes. The error says so; read the note before retrying.
- **Creating or deleting folders makes Notes stall for minutes** on the machine I tested. mcpify has no folder tools, and the tests reuse one folder for that reason.
- **Formatting.** Input is plain text. `replace` drops the old formatting. `append` keeps it. Notes rewrites the HTML it stores (for example `&lt` without the semicolon).
- **Locked notes and notes with attachments** are never edited. Both refusal paths are in the code but **not covered by tests** yet (no locked note or attachment in the test setup).
- **`generate` is read only and tested on Notes only.** Other apps need a separate macOS permission prompt, which I did not trigger overnight. Dictionary quirks in other apps (odd plural names, classes without ids, slow properties) are untested.
- **Apps with no scripting dictionary** (Calculator, many third-party apps) are not covered. They would need the Accessibility API, which v0 does not use.
- **Scale.** Tested on one library of about 350 notes in three accounts. Writes were tested only in the default iCloud account.
- **Agent demo is read only.** On the machine where this was built, a safety hook blocks MCP tools that write to an unknown service when a child agent calls them, so the recorded agent session only searches and reads. Writes are shown in the scripted transcript and the tests.
- **Prior art.** Several Apple Notes MCP servers already exist on GitHub, some with more tools than this one. Notes is the test case here, not the point. What mcpify adds is the generator and the habit of testing against the real app.

## Demo

- [`demo/transcript.md`](demo/transcript.md): a scripted MCP session (create, search, append, read, an error), checked against Notes with raw `osascript`.
- [`demo/agent-transcript.md`](demo/agent-transcript.md): Claude Code finding and reading a note through mcpify. Rerun with `scripts/agent-demo.sh`.

Note ids in the transcripts have the Notes store UUID replaced with `<store>`.

## Test evidence

Final runs, 2026-10-21 01:20 to 01:23 local time, macOS 26.5.2, Node 26.10.0, MCP SDK 1.32.1, a Notes library of about 350 notes in three accounts:

| Run | Tests | Passed | Wall time | Per-call medians |
|---|---|---|---|---|
| 1 | 15 | 15 | 8.7 s | 0.15 to 0.34 s |
| 2 | 15 | 15 | 5.4 s | 0.15 to 0.34 s |
| 3 | 15 | 15 | 29.5 s | 0.41 to 2.5 s |

Raw logs are not committed; rerun with `npm test` (it prints a `TIMINGS` line).

Earlier the same night, with another heavy job loading the disk, two runs failed: 9 of 12 tests passed in one, and in the other every end-to-end test failed in setup, because Notes did not answer within 60 s, and later not within Apple's own 120 s. After about an hour of test traffic under that load, Notes stayed slow (3 to 25 s for a trivial call) until it was quit and relaunched. The three passing runs above came after that relaunch.

Bugs the real-app tests found and that are fixed:

- `list_folders` asked each folder for its count separately and took over 60 s. One bulk request takes about 0.3 s.
- A timed-out call returned the whole JXA script as its error text. It now returns a short message, and for writes it warns that the change may still be applied.

Agent demo: Claude Code 2.1.303 (Sonnet) found and read the seeded note in two tool calls, 4 turns, 16.1 s end to end.

## License

MIT
