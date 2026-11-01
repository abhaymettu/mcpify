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

{{RESULTS}}

## What building it taught me

- **Dictionaries are messier than they look.** Most apps pull Apple's Standard Suite in with `xi:include`, and some do it inside a suite rather than at the top. Missing that one case silently cost Calendar its create tools. Calendar names its identifier `uid` rather than `id`. Music's `playlist` is abstract, so new playlists are `user playlist` objects inside a source. TextEdit types its text as a class referenced by id (`text.ctxt`). Photos marks every element read-only, so a generator that trusts the dictionary makes no create tools, even though Photos can in fact make albums.
- **Some apps ignore properties given at creation.** TextEdit makes the document and drops the text. The generated create tool now reads each property back and sets any that did not take.
- **Permissions are the real setup cost.** Each app needs its own Automation grant, and Calendar, Contacts and Photos also need the calling app to hold their data permission. A pending permission prompt can stall Apple Events to other apps while it waits.
- **Apple Events are cheap until the machine is busy.** A list call that takes 0.3 s on a quiet Mac took 25 s at a load average near 100. One Apple Event per property, covering the whole collection, keeps that bounded. Fewer default fields keeps it tolerable.
- **One generated tool call is not one script.** An agent with raw `osascript` can fold a whole task into one script. With typed tools, the same task takes two or three calls. That is the price of typed, checked, scoped access, and the comparison below measures it.

## Limits

{{LIMITS}}

Code, tests and the full method: [github.com/abhaymettu/mcpify](https://github.com/abhaymettu/mcpify).
