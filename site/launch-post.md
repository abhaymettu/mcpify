# Launch post draft (for Abhay to post himself; not posted)

**X / short:**

mcpify: point it at any scriptable Mac app and get an MCP server, generated from the app's AppleScript dictionary. Read-only by default, writes need a confirm. {{HEADLINE}}

`claude mcp add reminders -- npx -y github:abhaymettu/mcpify Reminders`

github.com/abhaymettu/mcpify

**Longer (HN "Show" style title, if he wants one):**

Show HN: mcpify – generate MCP servers for Mac apps from their AppleScript dictionaries

Most Mac apps have no API, but many ship a scripting dictionary. mcpify turns that dictionary into typed tools (list/get/create/update per class, plus the app's own commands), checks every generated tool against the live app, and gates writes behind a flag, a confirm step and an optional scope. I measured Claude Code doing {{N}} tasks across {{APPS}} apps with the generated tools against the same tasks with raw osascript: {{RESULT}}. Limits are in the README.
