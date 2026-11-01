Coverage report, last updated 2026-11-01T12:28:04.056Z (per-app run times in coverage.json). Generated with `--writes --allow-delete` so every tool is counted; the default server is read only.

| App | Classes | Tools (read / write) | Read pass | Read fail | Read not reached | Write round trip | Failures and notes |
|---|---|---|---|---|---|---|---|
| Keynote | 0 | 0 / 0 | 0 | 0 | 0 | 0 of 0 | Command failed: claude-helper osascript -l JavaScript -e function run(argv){const app=Application("…");const args=JSON.parse(argv[0]);const r=((app) => { const  |
| Numbers | 0 | 0 / 0 | 0 | 0 | 0 | 0 of 0 | Command failed: claude-helper osascript -l JavaScript -e function run(argv){const app=Application("…");const args=JSON.parse(argv[0]);const r=((app) => { const  |
| Pages | 0 | 0 / 0 | 0 | 0 | 0 | 0 of 0 | Command failed: claude-helper osascript -l JavaScript -e function run(argv){const app=Application("…");const args=JSON.parse(argv[0]);const r=((app) => { const  |
| Reminders | 5 | 11 / 9 | 8 | 0 | 3 | 3 of 3 |  |
| Notes | 6 | 13 / 14 | 9 | 0 | 4 | 3 of 3 |  |
| Calendar | 9 | 19 / 17 | 7 | 0 | 12 | 3 of 3 |  |
| Contacts | 12 | 25 / 38 | 7 | 0 | 18 | 3 of 3 |  |
| Music | 23 | 47 / 74 | 36 | 0 | 11 | 3 of 3 |  |
| Finder | 14 | 29 / 46 | 23 | 0 | 6 | 3 of 3 |  |
| TextEdit | 2 | 5 / 4 | 5 | 0 | 0 | 3 of 3 |  |
| Photos | 4 | 9 / 14 | 4 | 1 | 4 | 0 of 0 | list_media_items: Photos did not answer within 120 s. It may be busy (syncing or reading its store); try again.; dictionary marks every element read only, so mcpify generates no create tools |
| Safari | 3 | 7 / 12 | 7 | 0 | 0 | 1 of 3 | update_document: Can't get object.; delete_document: nothing at documents[name="…"] |
| Mail | 20 | 41 / 64 | 13 | 0 | 28 | 0 of 0 | read only by design here; the sweep reads no messages |
| **All** | 98 | 206 / 292 | 119 | 1 | 86 | 22 of 24 | |
