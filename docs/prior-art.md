# Prior art

Checked 2026-11-01. Stars and last push dates come from the GitHub API on that day.

## Tools that generate MCP tools from a scripting dictionary

| Project | What it does | How mcpify differs |
|---|---|---|
| [sdef2md + sdef-to-mcp skill](https://ai.rud.is/posts/2026-04-24-sdef-to-md-and-mcp-skill/) (hrbrmstr, April 2026) | Turns an sdef into Markdown. An agent skill then writes a Go MCP server with "tool registrations and handler stubs for every command and class". | Its output is a starting point: the JXA is marked "starters, not production code", and the claim is that it compiles. mcpify's tools run as generated, every generated tool is called against the live app, and writes are gated. |
| [aredigg/MCP-server-AppleScript-wrapper](https://github.com/aredigg/MCP-server-AppleScript-wrapper) (0 stars, Dec 2025) | `mcp_osacreate <App>` writes a Python wrapper and a FastMCP server, one tool per dictionary command. | One tool per command. Classes are not exposed as objects you can list, filter and read. To make it safe you delete risky tools by hand. The README shows no tests. |
| [reverendish/mcp-x-mac-seed](https://github.com/reverendish/mcp-x-mac-seed) (1 star, May 2026) | Eight seed tools. The agent reads a dictionary and writes its own per-app tools at runtime, with a repair loop. | The agent writes the tools, so they differ from run to run. It has consent gating. It reports unit tests, but no measured agent success rate. |
| [benlenarts/sdef-mcp](https://github.com/benlenarts/sdef-mcp) (0 stars) | Lets an agent browse dictionaries. | It generates nothing. |

## Generic "run a script" servers

| Project | What it does |
|---|---|
| [steipete/macos-automator-mcp](https://github.com/steipete/macos-automator-mcp) (883 stars) | One `execute_script` tool for AppleScript or JXA, plus a library of example scripts. |
| [peakmojo/applescript-mcp](https://github.com/peakmojo/applescript-mcp) (466 stars) | One `applescript_execute` tool. |
| [joshrutkowski/applescript-mcp](https://github.com/joshrutkowski/applescript-mcp) (395 stars) | Hand-written categories of scripts (calendar, Finder, clipboard and more). |

These give the agent the whole of AppleScript. The osascript arm of mcpify's agent suite works the same way: a Bash tool limited to `osascript`. So the suite measures typed generated tools against this approach.

## Hand-written per-app servers

[supermemoryai/apple-mcp](https://github.com/supermemoryai/apple-mcp) (3.1k stars) and [mattt/iMCP](https://github.com/mattt/iMCP) (1.9k stars) cover a handful of Apple apps with hand-written tools. iMCP uses system frameworks (EventKit, Contacts) rather than Apple Events. Either one is better than a generated server for the apps it covers. mcpify is for the long tail of apps nobody has written a server for.

## Benchmarks

[macOSWorld](https://arxiv.org/abs/2506.04135) (202 tasks, GUI agents) and [MacAgentBench](https://arxiv.org/abs/2606.22557) (676 tasks, any action space) measure agents on Mac apps. Neither compares typed per-app tools with raw osascript on the same tasks. mcpify's suite is much smaller (31 tasks) and runs entirely on test data.

## Older work

Apple's `sdp` (Scripting Bridge headers), [py-appscript](https://appscript.sourceforge.io/) and SwiftAutomation generate typed bindings from dictionaries. They showed that typed generation from an sdef works. None of them target agents.
