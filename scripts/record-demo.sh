#!/bin/sh
# Records the README demo: Claude Code moves a reminder's due date through a generated Reminders server,
# inside a throwaway list named mcpify-demo, with the confirm step. Writes demo/demo.jsonl and demo/demo.gif.
set -eu
cd "$(dirname "$0")/.."
OSA=${MCPIFY_OSASCRIPT:-osascript}
$OSA -l JavaScript -e 'const a=Application("Reminders");if(!a.lists.whose({name:"mcpify-demo"}).length)a.lists.push(a.List({name:"mcpify-demo"}));const l=a.lists.byName("mcpify-demo");l.reminders().forEach(r=>a.delete(r));l.reminders.push(a.Reminder({name:"Renew passport",dueDate:new Date("2026-12-01T10:30:00")}));l.reminders.push(a.Reminder({name:"Book dentist"}));"seeded"'
CFG=$(mktemp)
printf '{"mcpServers":{"reminders":{"command":"%s","args":["%s/src/cli.ts","Reminders","--writes","--confirm","token","--scope","lists[name=\\"mcpify-demo\\"]"],"env":{"MCPIFY_OSASCRIPT":"%s"}}}}' "$(command -v node)" "$PWD" "$OSA" > "$CFG"
P='Push "Renew passport" in my mcpify-demo list back one week.'
cd "$(mktemp -d)"
claude -p "$P" --model sonnet --strict-mcp-config --mcp-config "$CFG" --tools "" --allowedTools mcp__reminders \
  --setting-sources project --settings '{"claudeMdExcludes":["/Users/**/CLAUDE.md","/Users/**/.claude/**"],"autoMemoryEnabled":false}' \
  --output-format stream-json --verbose < /dev/null > "$OLDPWD/demo/demo.jsonl"
cd "$OLDPWD"
$OSA -l JavaScript -e 'const a=Application("Reminders");const d=a.lists.byName("mcpify-demo").reminders.byName("Renew passport").dueDate();a.lists.whose({name:"mcpify-demo"})().forEach(l=>a.delete(l));"due now "+d.toString()'
node scripts/cast.ts demo/demo.jsonl "claude mcp add reminders -- npx -y github:abhaymettu/mcpify Reminders --writes --scope 'lists[name=\"mcpify-demo\"]'" "$P" > demo/demo.cast
agg --font-size 15 --theme monokai demo/demo.cast demo/demo.gif > /dev/null 2>&1
echo "wrote demo/demo.gif"
