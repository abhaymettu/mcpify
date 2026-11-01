# RUNLOG

Work log for the 2026-11-01 push from "one app" to "many apps", for anyone picking this up later.

## 2026-11-01

**Novelty check (first).** I found two generators from sdef to MCP: sdef2md/sdef-to-mcp, which produces stubs, and aredigg's wrapper, which makes one tool per command. Neither tests against the live app, and neither has write gating or an agent benchmark. Details are in `docs/prior-art.md`. The gap mcpify fills is verified generation plus write safety plus a measured agent comparison, so I kept the direction.

**Generator v2.**
- Replaced the regex reader with an XML dictionary model. It resolves `xi:include` both at dictionary level and inside a suite. Calendar, Notes, Reminders and others pull in the Standard Suite this way, and without it Calendar had no `make`. It also merges class extensions and flattens inheritance.
- Identifier: the property with code `ID  `. Calendar names it `uid`.
- Tools now cover every class reachable from the application object, up to depth 4: `list_` (with where filter, fields and paging) and `get_` (all properties plus counts of what the object contains). There is also `get_application`.
- Objects are addressed by refs, such as `calendars[name="x"]/events[id="y"]`. Refs are parsed in Node, checked against the dictionary, and walked in JXA as data.
- Writes sit behind flags: `--writes` and `--allow-delete`. There is also `--dry-run`, `--confirm auto|elicit|token|none`, and `--scope`, where scope refs are compared after converting them to id form.

**macOS permissions (cost the most time).** The process responsible for the agent here is T3 Code. It had Automation access only for Reminders and System Events. Each new app raised a hidden prompt, and while a prompt waited, other Apple Event permission checks queued behind it. Calendar and Contacts also need the caller to hold Calendar or Contacts data access. I routed every run through a helper app that already holds the grants (`MCPIFY_OSASCRIPT="<helper> osascript"`). The agent suite puts the same wrapper on PATH as `osascript`, so both arms go through it.

**Load.** Other lanes kept the load average between 85 and 120 for the whole run. Apple Events that take 0.2 s on a quiet machine took 2 to 60 s here. Timeouts are raised: 120 s per call in coverage, 480 s per agent run.

**Privacy.**
- The coverage sweep records pass/fail only, and it scrubs quoted strings from error text.
- In personal-data apps the sweep starts inside `mcpify-test` containers, and top-level lists are filtered to test names.
- One early failing agent run named the user's real Reminders lists in its answer. I deleted that file. Answers and transcripts now go only to the gitignored `bench/results/local/`.

**Bugs the live runs found and that are fixed:**
- Includes nested inside a suite were ignored, so Calendar had no create tools.
- TextEdit makes a document but drops properties given at creation. Create now sets back any property that did not take.
- The list summary read 9 properties, one Apple Event each, and timed out under load. It now reads 5 at most.
- Music `playlist` is abstract, so the fixture uses `user playlist` inside the Library source.
- Finder cannot see hidden folders, so the test folder moved from `/private/tmp` to `~/mcpify-test`.
- The scope given by name did not match refs returned by id. Both are now compared in canonical form.

**Tests.** `test/safety.e2e.test.ts` passed 6 of 6 against live Reminders: read-only default, dry run, token codes (they bind their arguments and work once), scope by name and by id, elicitation (accept and decline), and deletes only behind their flag. `test/dictionary.test.ts` passed 6 of 6.

**Packaging.** Node will not strip types inside `node_modules`, so `src/` is built to a committed `dist/`. The `npm pack` install was tested in a temp dir and `mcpify tools Reminders` ran.

## Next

- Finish the coverage rerun and the agent suite; put the numbers in README and `site/`.
- Make the demo GIF from a recorded run (`scripts/cast.ts`, then `agg`).
- Test a fresh clone and the `npx github:` install, scan for secrets, make the repo public.

## 2026-11-01, 06:35 checkpoint

- Coverage report (`bench/results/coverage.md`, merged from per-app runs): all 13 apps tried. Every read tool that failed did so by timing out (Photos media items), plus one Finder ref-parse bug, now fixed. Music, Finder and TextEdit now pass their full write round trips after the make fallback and the rich-text fix. Keynote, Numbers and Pages timed out making their test document under load, in all three tries.
- Agent suite: two workers running in the background (`bench/results/agent-*.jsonl`; transcripts in `bench/results/local/`). Worker 1 covers Reminders and Notes. Worker 2 covers Calendar, Contacts, Music, Finder, TextEdit and Mail. Keynote tasks will be skipped if seeding fails.
- With the load average near 100, a single mcpify call to Reminders can take over 120 s. The osascript arm usually needs one process per task, while the mcpify arm needs 2 to 6 tool calls. Two mcpify runs hit the 480 s cap.
- Demo: `scripts/record-demo.sh` records into a throwaway `mcpify-demo` list. The first take timed out because the suite was using Reminders at the same time. The agent did the right thing: it did not retry a write that had timed out, and it said so. Re-record once the suite has moved off Reminders.
- Still to do: summarize the agent results, fill `{{RESULTS}}` and `{{LIMITS}}` in README and `site/writeup.md`, write `site/meta.json`, test a fresh clone and npx, run gitleaks, go public.
