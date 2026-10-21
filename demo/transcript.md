# mcpify demo transcript

Recorded 2026-10-21T06:20:56.091Z on macOS against the real Notes app, over stdio with the official MCP client.

## tools/list

- `list_folders` (read only): List every Notes folder across all accounts, with its id, account and note count.
- `list_notes` (read only): List notes, newest first. Optionally limit to one folder.
- `search_notes` (read only): Find notes whose title or text contains the query (matched inside Notes). Returns newest first with a snippet.
- `read_note` (read only): Read one note: title, folder, dates, plain text and HTML body. Locked notes return metadata only.
- `create_note` (writes): Create a note with a title and plain-text body. Goes to the default folder unless folder_id is given.
- `update_note` (writes): Append plain text to a note, or replace its body (keeping or changing the title). Refuses locked notes and notes with attachments, because rewriting their body can drop the attachments.

## Find the folder

```json
// call list_folders {}
// 2632 ms
{
  "shown": [
    {
      "id": "x-coredata://<store>/ICFolder/p735",
      "name": "mcpify-test",
      "account": "iCloud",
      "note_count": 0
    }
  ],
  "other_folders_omitted": 12
}
```

## Create a note

```json
// call create_note {"title":"Trip packing list","body":"passport\nchargers\nrain jacket","folder_id":"x-coredata://<store>/ICFolder/p735"}
// 2636 ms
{
  "id": "x-coredata://<store>/ICNote/p753",
  "name": "Trip packing list",
  "folder": "mcpify-test",
  "folder_id": "x-coredata://<store>/ICFolder/p735"
}
```

## Search for it

```json
// call search_notes {"query":"rain jacket"}
// 2350 ms
{
  "total": 3,
  "notes": [
    {
      "id": "x-coredata://<store>/ICNote/p753",
      "name": "Trip packing list",
      "modified": "2026-10-21T06:20:59.000Z",
      "snippet": "Trip packing list\npassport\nchargers\nrain jacket\n"
    }
  ],
  "other_matches_omitted": 2
}
```

## Add a line

```json
// call update_note {"id":"x-coredata://<store>/ICNote/p753","text":"sunscreen","mode":"append"}
// 1849 ms
{
  "id": "x-coredata://<store>/ICNote/p753",
  "name": "Trip packing list",
  "modified": "2026-10-21T06:21:05.000Z",
  "mode": "append"
}
```

## Read it back

```json
// call read_note {"id":"x-coredata://<store>/ICNote/p753"}
// 931 ms
{
  "id": "x-coredata://<store>/ICNote/p753",
  "name": "Trip packing list",
  "folder": "mcpify-test",
  "folder_id": "x-coredata://<store>/ICFolder/p735",
  "created": "2026-10-21T06:20:59.000Z",
  "modified": "2026-10-21T06:21:05.000Z",
  "locked": false,
  "attachments": 0,
  "text": "Trip packing list\npassport\nchargers\nrain jacket\nsunscreen\n"
}
```

## A note that does not exist

```json
// call read_note {"id":"x-coredata://<store>/ICNote/p1"}
// 129 ms, isError
"no note with id x-coredata://<store>/ICNote/p1"
```

## Independent check (raw osascript, not mcpify)

```json
{"name":"Trip packing list","text":"Trip packing list\npassport\nchargers\nrain jacket\nsunscreen\n"}
```

The demo note was then deleted (it goes to Notes' Recently Deleted).
