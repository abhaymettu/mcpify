# Launch post draft (for Abhay to post himself; not posted)

**X / short:**

mcpify: point it at any scriptable Mac app and get an MCP server, generated from the app's AppleScript dictionary. Read-only by default, writes need a confirm. 98 classes across 13 apps; Claude Code passed 29/29 test tasks with it.

`claude mcp add reminders -- npx -y github:abhaymettu/mcpify Reminders`

github.com/abhaymettu/mcpify

**Longer (HN "Show" style title, if he wants one):**

Show HN: mcpify, generate MCP servers for Mac apps from their AppleScript dictionaries

Most Mac apps have no API, but many ship a scripting dictionary. mcpify turns that dictionary into typed tools (list/get/create/update per class, plus the app's own commands), checks every generated tool against the live app, and gates writes behind a flag, a confirm step and an optional scope. I measured Claude Code doing 29 tasks across 8 apps with the generated tools against the same tasks with raw osascript: 29/29 for both, but the typed tools took 3 calls and about 3x the time where raw osascript took 1, and what you get for that is read-only default, scoped writes and a confirm step. Limits are in the README.
