58 runs, 29 tasks, 8 apps, 19 skipped because seeding the test data failed, files: agent-2026-11-01T12-06-39-312Z.jsonl, agent-2026-11-01T12-22-08-767Z.jsonl, agent-2026-11-01T12-43-56-600Z.jsonl, agent-2026-11-01T12-44-03-724Z.jsonl, agent-2026-11-01T12-44-11-693Z.jsonl, agent-2026-11-01T13-20-45-893Z.jsonl, agent-2026-11-01T13-24-26-327Z.jsonl

| Arm | Success | Collateral changes | Median tool calls | Median tool errors | Median time | Total cost (API-equivalent) |
|---|---|---|---|---|---|---|
| mcpify | 26/29 (90%) | 0 | 4 | 0 | 31.3 s | $1.41 |
| osascript | 29/29 (100%) | 0 | 1 | 0 | 8.0 s | $0.24 |

By app:

| App | mcpify | osascript |
|---|---|---|
| Reminders | 5/6 | 6/6 |
| Calendar | 3/5 | 5/5 |
| Notes | 4/4 | 4/4 |
| Mail | 1/1 | 1/1 |
| Contacts | 3/3 | 3/3 |
| Music | 3/3 | 3/3 |
| Finder | 5/5 | 5/5 |
| TextEdit | 2/2 | 2/2 |

By task:

| Task | mcpify | osascript |
|---|---|---|
| rem-count-open | pass | pass |
| rem-add-due | pass | pass |
| rem-complete | pass | pass |
| rem-priority | pass | pass |
| rem-push-due | fail (exit 143: ) | pass |
| rem-delete | pass | pass |
| cal-create | pass | pass |
| cal-start-time | fail | pass |
| cal-week-count | pass | pass |
| cal-move | fail (exit 143: ) | pass |
| notes-find-secret | pass | pass |
| notes-create | pass | pass |
| notes-count | pass | pass |
| notes-append | pass | pass |
| mail-accounts | pass | pass |
| cal-location | pass | pass |
| contacts-org | pass | pass |
| contacts-title | pass | pass |
| contacts-count | pass | pass |
| music-create | pass | pass |
| music-rename | pass | pass |
| music-volume | pass | pass |
| finder-count-md | pass | pass |
| finder-new-folder | pass | pass |
| finder-rename | pass | pass |
| finder-comment | pass | pass |
| finder-largest | pass | pass |
| textedit-new | pass | pass |
| textedit-read | pass | pass |
