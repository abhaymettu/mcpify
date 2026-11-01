# AGENTS.md

Notes for coding agents working on mcpify.

## Layout

- `src/sdef.ts` reads a scripting dictionary (via `sdef`) into a model. It resolves `xi:include`, class extensions and inheritance.
- `src/generate.ts` turns that model into tools. Each class reachable from the application gets `list_` and `get_`. With `--writes` it adds `create_`, `update_` and app commands. With `--allow-delete` it adds `delete_` and destructive commands. Every tool is a JXA function source string.
- `src/ref.ts` defines the ref format (`lists[id="..."]/reminders[name="..."]`) and the JXA prelude (`resolve`, `plain`) that every tool shares.
- `src/server.ts` is the MCP server and the write gate: dry run, scope, and confirmation by elicitation or a one-time code.
- `src/jxa.ts` runs one JXA function through `osascript`. Arguments go in as JSON on argv, never into the script text.
- `src/apps/notes.ts` is the hand-written Notes server from v0, kept for comparison (`mcpify serve notes`).
- `bench/` holds the live coverage sweep (`coverage.ts`, `fixtures.ts`) and the agent suite (`agent.ts`, `tasks.ts`, `summarize.ts`).

## Rules

- Agent text must never become script text. Refs are parsed in Node, checked against the dictionary, and passed as data. Check any new tool argument the same way.
- Read-only stays the default. A new write path needs a `preview` (no side effects) so dry run and confirmation can show it.
- Tests run against the real apps. Use the `mcpify-test` / `mcpify-safety` containers, never the user's data. Grade with raw `osascript`, not with mcpify code.
- Never print or commit values read from a user's apps. The coverage sweep records pass/fail only, and agent answers and transcripts go to the gitignored `bench/results/local/`.
- `dist/` is committed so `npx github:abhaymettu/mcpify` works without install scripts. Run `npm run build` after changing `src/`.

## Commands

```sh
npm run typecheck
npm run test:unit                  # dictionary model and generator, no Apple Events
npm test                           # everything, including live Notes and Reminders tests
npm run coverage -- Reminders      # live sweep for one app
npm run bench -- --apps Reminders  # agent suite for one app (uses your Claude Code login)
```

If your terminal app lacks Automation permission for an app, set `MCPIFY_OSASCRIPT` to a wrapper that has it (for example `my-helper osascript`). Calendar, Contacts and Photos also need the caller to hold that app's own privacy permission.
