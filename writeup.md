# mcpify writeup (draft, internal)

Status: draft for review. Not published. Numbers are from the runs recorded in the README's Test evidence section.

## The 20-second clip

1. (0 to 5 s) Terminal: `mcpify inspect /System/Applications/Notes.app`. The app's scripting dictionary scrolls by: accounts, folders, notes, their properties.
2. (5 to 10 s) `mcpify generate /System/Applications/Notes.app`. The server lists eight read-only tools made from that dictionary with no Notes code (`list_` and `get_` for accounts, folders, notes and attachments). This is the tool list the generate tests check; it isn't recorded as a clip yet.
3. (10 to 17 s) Claude Code connected to the hand-written server, `mcpify serve notes`, is asked what's left on the Saturday errands list. It searches, reads the note, and answers, in two tool calls (`demo/agent-transcript.md`). This step uses the hand-written server, not the generated one.
4. (17 to 20 s) Card: "A Mac app's scripting dictionary, turned into an MCP server. One app so far, tested against the real app."

The clip should only show the test folder, never real notes.

## What was built

- A small runner that sends JXA to a Mac app through `osascript`, with arguments passed as JSON so agent text cannot become code.
- A hand-written Notes server with six tools: list folders, list notes, search, read, create, update. No delete.
- A generator that turns any scripting dictionary into read-only `list_` and `get_` tools. On Notes it makes eight.
- End-to-end tests that start each server, connect the official MCP client, call the tools against the real Notes app, and check every result with a separate raw `osascript` read.
- Two transcripts: a scripted MCP session and a Claude Code session.

## What I learned building it

- Notes does its scripting on the main thread. When the disk is busy, a single call can take over a minute, and Apple's 2 minute Apple Event timeout can fire. On a quiet machine calls took under about a second.
- A write that times out is not a failed write. The event is still queued inside Notes and can land later. The server's error message says that now.
- Making and deleting folders made Notes stall for minutes, so the tests reuse one folder.
- Asking each folder for its note count one by one took over 60 seconds. One bulk request for all of them took about 0.3 seconds.
- Notes rewrites the HTML you give it (entities lose their semicolons). Plain text round trips correctly, and that is what the tests check.

## Honest numbers

- Tools: 6 hand-written, 8 generated, for one app.
- Tests: 15, all passing in three runs in a row after Notes was relaunched (5.4 to 29.5 s per run). Two earlier runs failed under heavy disk load because Notes stopped answering.
- Speed when Notes is healthy: per-call medians 0.15 to 2.5 s, with one 9.7 s outlier earlier. Under heavy disk load: 8 to 81 s per call, with timeouts.
- Agent demo: 2 tool calls, 16.1 s end to end, correct answer.
- Apps tried: one (Notes). Apps the generator was tried on: one (Notes).

## What it is not yet

- Not shown on a second app. That is the next step and the real test of the idea.
- No support for apps without a scripting dictionary.
- Not new as a Notes server: several Apple Notes MCP servers already exist. The new part is the generator plus testing against the real app.

## Next

1. Run `generate` on two or three more apps (Reminders, Music, a third-party app with a dictionary) and fix whatever the dictionaries break.
2. Add write tools to the generator for commands the dictionary declares, behind an explicit opt in.
3. Look at the Accessibility API for apps with no dictionary.
