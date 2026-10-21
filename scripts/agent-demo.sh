#!/bin/sh
# Read-only agent demo: seed one note in "mcpify-test" with raw osascript, then let Claude Code
# find and read it through mcpify. Writes are left out of the agent run on purpose; see README.
set -eu
cd "$(dirname "$0")/.."
TOK="zebra$(date +%s)"
osascript -l JavaScript -e "const a=Application('Notes');const f=a.defaultAccount().folders.byName('mcpify-test');f.notes.push(a.Note({body:'<div><h1>Saturday errands $TOK</h1></div><div>pick up dry cleaning</div><div>buy birthday card</div><div>return library books</div><div>call grandma</div>'}));'seeded'"
CFG=$(mktemp); printf '{"mcpServers":{"notes":{"command":"%s","args":["%s/src/cli.ts","serve","notes"]}}}' "$(command -v node)" "$PWD" > "$CFG"
P="Use the Apple Notes tools, read only. Find my note containing '$TOK', read it, and tell me in one short sentence what is left on the list. Do not open any other note."
claude -p "$P" --strict-mcp-config --mcp-config "$CFG" --allowedTools "mcp__notes__search_notes,mcp__notes__read_note" --output-format stream-json --verbose < /dev/null > /tmp/mcpify-agent.jsonl
node scripts/render-agent.ts /tmp/mcpify-agent.jsonl "$P"
osascript -l JavaScript -e "const a=Application('Notes');a.notes.whose({name:{_contains:'$TOK'}})().forEach(n=>a.delete(n));'cleaned'"
