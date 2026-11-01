Coverage run 2026-11-01T11:49:00.654Z. Generated with `--writes --allow-delete` so every tool is counted; the default server is read only.

| App | Classes | Tools (read / write) | Read pass | Read fail | Read not reached | Write round trip | Failures and notes |
|---|---|---|---|---|---|---|---|
| Reminders | 5 | 11 / 9 | 8 | 0 | 3 | 3 of 3 |  |
| Notes | 6 | 13 / 14 | 9 | 0 | 4 | 3 of 3 |  |
| Calendar | 9 | 19 / 17 | 7 | 0 | 12 | 3 of 3 |  |
| Contacts | 12 | 25 / 38 | 6 | 0 | 19 | 0 of 1 | create_person: refused: create_person has no target inside the allowed scope (groups[name="…"]) |
| Music | 23 | 47 / 74 | 36 | 0 | 11 | 0 of 1 | create_user_playlist: MCP error -32602: Input validation error: Invalid arguments for tool create_user_playlist: Invalid input: expected string, received undefined at parent |
| Finder | 0 | 0 / 0 | 0 | 0 | 0 | 0 of 0 | Command failed: claude-helper osascript -l JavaScript -e function run(argv){const app=Application("…");const args=JSON.parse(argv[0]);const r=((app) => { const  |
| TextEdit | 2 | 5 / 4 | 4 | 0 | 1 | 0 of 1 | create_document: created, but raw osascript did not find it |
| Keynote | 0 | 0 / 0 | 0 | 0 | 0 | 0 of 0 | spawnSync claude-helper ETIMEDOUT |
| Numbers | 18 | 37 / 44 | 4 | 1 | 32 | 0 of 0 | list_documents: Numbers did not answer within 45 s. It may be busy (syncing or reading its store); try again. |
| Pages | 23 | 47 / 41 | 4 | 1 | 42 | 0 of 0 | list_documents: Pages did not answer within 45 s. It may be busy (syncing or reading its store); try again. |
| Safari | 3 | 7 / 12 | 7 | 0 | 0 | 0 of 1 | create_document: created, but raw osascript did not find it |
| Mail | 20 | 41 / 64 | 13 | 0 | 28 | 0 of 0 | read only by design here; the sweep reads no messages |
| Photos | 4 | 9 / 14 | 4 | 1 | 4 | 0 of 0 | list_media_items: Photos did not answer within 45 s. It may be busy (syncing or reading its store); try again.; dictionary marks every element read only, so mcpify generates no create tools |
| **All** | 125 | 261 / 331 | 102 | 3 | 156 | 9 of 13 | |
