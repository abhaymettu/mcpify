# mcpify: Mac apps as MCP servers, generated and tested

Most Mac apps an agent might want to use have no API. A lot of them do ship an AppleScript dictionary, a machine-readable description of their objects and commands that has been sitting in app bundles since the 1990s. mcpify reads that dictionary and generates an MCP server from it: typed `list_`, `get_`, `create_` and `update_` tools for every class, plus the app's own commands. It is read-only by default. Writes sit behind flags, a confirm step and an optional scope.

The point of the project is that the generated tools are tested, not just generated. Every tool the sweep can reach is called against the live app, and a create, update and delete round trip in a test container is checked with raw `osascript` reads that don't use mcpify code.

## What it does

```sh
claude mcp add reminders -- npx -y github:abhaymettu/mcpify Reminders
```

That one line gives Claude Code tools such as `list_lists`, `list_reminders` (filter by `where: {completed: false}`, page with `limit`), `get_reminder` and `get_application`. With `--writes` it adds `create_reminder`, `update_reminder` and `show`. With `--allow-delete` it adds `delete_reminder`. The same command works for Calendar, Music, Finder, Keynote, Mail or any other app with a dictionary.

Objects are addressed by refs, such as `calendars[name="Work"]/events[id="..."]`. Refs are parsed and checked against the dictionary before anything runs, and they reach the app as data, so text from the agent never becomes script.

## Results

**Coverage, 13 apps** (`npm run coverage`, full table in [bench/results/coverage.md](https://github.com/abhaymettu/mcpify/blob/main/bench/results/coverage.md)). mcpify generated 206 read tools and 292 write tools from 98 classes:
- Every read tool the live sweep reached passed, except one Photos call that timed out.
- Create, update and delete round trips, each step checked with raw `osascript`, passed in 7 apps: Reminders, Notes, Calendar, Contacts, Music, Finder and TextEdit.
- Keynote, Numbers and Pages timed out making a test document under load, so they are untested.
- Mail is swept for structure only and reads no messages.

**Agent suite: 31 tasks across 9 apps** (`npm run bench`). Claude Code (Sonnet) did each task twice: once with the generated server, once with only a Bash tool limited to `osascript`. Raw `osascript` reads graded each run. The two Keynote tasks were skipped on both arms, because Keynote never finished creating its test document. 29 tasks remained ([results](https://github.com/abhaymettu/mcpify/blob/main/bench/results/agent.md)):

| Arm | Success | Changes outside test data | Median tool calls | Median time |
|---|---|---|---|---|
| mcpify (generated tools) | 29/29 | 0 | 3 | 23.8 s |
| raw osascript | 29/29 | 0 | 1 | 7.9 s |

The first pass went 26/29 for mcpify ([first pass](https://github.com/abhaymettu/mcpify/blob/main/bench/results/agent-first-pass.md)). The three failures were real generator bugs, all fixed and rerun:
- Calendar rejected an update that set the start after the end.
- Calendar's identifier cannot be read in bulk, so lists came back without refs.
- Dates came back in UTC, and the agent read 18:15Z as local time.

The honest summary: a strong model already writes good AppleScript. Typed tools do not make it more accurate on these tasks. They make it slower: three calls where one script would do, and about six times the API-equivalent cost. What they buy is control. The agent can read but not write unless you pass `--writes`. Writes stay inside the `--scope` you give, and each one shows a plan and needs a confirm. The osascript arm has none of that: its one tool can run any script, including `do shell script`.

## What building it taught me

- **Dictionaries are messier than they look.** Most apps pull Apple's Standard Suite in with `xi:include`, and some do it inside a suite rather than at the top. Missing that one case silently cost Calendar its create tools. Calendar names its identifier `uid` rather than `id`. Music's `playlist` is abstract, so new playlists are `user playlist` objects inside a source. TextEdit types its text as a class referenced by id (`text.ctxt`). Photos marks every element read-only, so a generator that trusts the dictionary makes no create tools, even though Photos can in fact make albums.
- **Some apps ignore properties given at creation.** TextEdit makes the document and drops the text. The generated create tool now reads each property back and sets any that did not take.
- **Permissions are the real setup cost.** Each app needs its own Automation grant, and Calendar, Contacts and Photos also need the calling app to hold their data permission. A pending permission prompt can stall Apple Events to other apps while it waits.
- **Apple Events are cheap until the machine is busy.** A list call that takes 0.3 s on a quiet Mac took 25 s at a load average near 100. One Apple Event per property, covering the whole collection, keeps that bounded. Fewer default fields keeps it tolerable.
- **One generated tool call is not one script.** An agent with raw `osascript` can fold a whole task into one script. With typed tools, the same task takes two or three calls. That is the price of typed, checked, scoped access, and the results above measure it.

## Limits

- **One machine, one rep.** macOS 26.5. The load average sat between 85 and 120 from other jobs the whole time, so the timings are slow and noisy. Each task ran once per arm, with one model (Sonnet).
- **Latency.** Each tool call starts an `osascript` process. Under load a single Apple Event to Reminders or Calendar took up to two minutes.
- **iWork untested.** Keynote, Numbers and Pages timed out creating documents by script on this machine.
- **The dictionary is taken at its word.** Photos marks every element read only, so mcpify makes no create tools for it, even though Photos can make albums. Apps whose dictionaries are wrong get wrong tools.
- **Refs by name break on rename.** Objects with no readable id (Safari documents, Finder items) are selected by name. Renaming one invalidates its ref.
- **Permissions.** Every app needs its own Automation grant. Calendar, Contacts and Photos also need the calling app to hold their data permission.
- **No dictionary, no server.** Apps without a dictionary (Calculator and many others) would need the Accessibility API, which mcpify does not use.
- **Tool count.** Big dictionaries make many tools: System Events gets 132. `--depth` trims them.

Code, tests and the full method: [github.com/abhaymettu/mcpify](https://github.com/abhaymettu/mcpify).
