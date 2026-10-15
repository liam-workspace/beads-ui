# beads-ui WebSocket Protocol (v2.0.0)

Note (2025-10-26)

- The server no longer implements legacy read RPCs `list-issues` and
  `epic-status`. Clients must use the push-only protocol described in
  `docs/protocol/issues-push-v2.md` (subscribe-list with per-subscription events
  snapshot/upsert/delete). The shapes below are retained for historical
  reference of v1.

This document defines the JSON messages exchanged between the browser client and
the local server.

- Transport: single WebSocket connection
- Encoding: JSON text frames
- Correlation: all request/response pairs share the same `id`

## Envelope Shapes

- RequestEnvelope: `{ id: string, type: string, payload?: any }`
- ReplyEnvelope:
  `{ id: string, ok: boolean, type: string, payload?: any, error?: { code: string, message: string, details?: any } }`

Server may send unsolicited events (e.g., subscription
`snapshot`/`upsert`/`delete`) using the ReplyEnvelope shape with `ok: true` and
a generated `id`.

## Message Types

- Removed in v2: `list-issues` (use subscriptions + push stores)
- `update-status` payload:
  `{ id: string, status: 'open'|'in_progress'|'blocked'|'deferred'|'closed' }`
  (bd's `pinned` and `hooked` statuses are machine-managed and rejected here)
- `edit-text` payload:
  `{ id: string, field: 'title'|'description'|'acceptance'|'notes'|'design', value: string }`
- `update-priority` payload: `{ id: string, priority: 0|1|2|3|4 }`
- `create-issue` payload:
  `{ title: string, type?: 'bug'|'feature'|'task'|'epic'|'chore', priority?: 0|1|2|3|4, description?: string }`
- `list-ready` payload: `{}`
- Removed in v2: `subscribe-updates` and the `issues-changed` event. All list
  and detail updates flow via per-subscription push envelopes
  (`snapshot`/`upsert`/`delete`).
- `dep-add` payload: `{ a: string, b: string, view_id?: string }` where `a`
  depends on `b` (i.e., `a` is blocked by `b`). Reply payload is the updated
  issue for `view_id` (or `a` when omitted).
- `dep-remove` payload: `{ a: string, b: string, view_id?: string }` removing
  the `a` depends on `b` link. Reply payload is the updated issue for `view_id`
  (or `a`).
- `list-attachments` payload: `{ id: string }`. Reply payload is
  `AttachmentRow[]`: the rows of `bdw hub attachments <id> --json`, unchanged
  and in the order bdw lists them; `[]` when the issue has no evidence files. An
  `AttachmentRow` is
  `{ path: string, abs_path: string, bytes: number | null, mime: string, source: 'referenced' | 'fix-folder', missing: boolean }`:
  `path` is relative to the workspace root (`attachments/…`), `bytes` is `null`
  when `missing` is `true`. Example reply payload:
  `[{ path: 'attachments/fix-bui-a1/login.png', abs_path: '/home/me/hub/projects/demo/issues/attachments/fix-bui-a1/login.png', bytes: 20480, mime: 'image/png', source: 'fix-folder', missing: false }, { path: 'attachments/old.png', abs_path: '/home/me/hub/projects/demo/issues/attachments/old.png', bytes: null, mime: 'image/png', source: 'referenced', missing: true }]`.
  Errors, checked in this order:
  - `bad_request` when `id` is not a string matching
    `^[A-Za-z0-9][A-Za-z0-9._-]*$` (the same pattern as the HTTP route's `:id`,
    so an id can never reach bdw as a flag such as `--check`); bdw is then never
    run;
  - `attachments_unavailable`, message
    `Attachments need bdw in a hub workspace.`, when the bd binary (`BD_BIN`) is
    not named `bdw` (the command is then never run), or when bdw exits 2 and its
    stderr contains the text `not inside a hub workspace` (both must hold: exit
    2 alone is also bdw's usage error);
  - `bd_error` for any other non-zero exit (any other exit 2 included), message
    = the command's stderr, trimmed (`bdw exited with code <n>` when stderr is
    empty), and for output that is not a JSON array. Example:
    `{ code: 'bd_error', message: 'database locked' }`.

  The listing is read on every request (never cached) and is read-only: it never
  pulls, exports, commits or changes the issue.

## Mapping to `bd` CLI

- Removed in v2: `list-issues` → use subscriptions and push
  (`docs/protocol/issues-push-v2.md`)
- `update-status` → `bd update <id> --status <status>`
- `edit-text` → `bd update <id> --title <t>` or `--description <d>` or
  `--acceptance-criteria <a>` or `--notes <n>` or `--design <z>`
- `update-priority` → `bd update <id> --priority <n>`
- `create-issue` → `bd create "title" -t <type> -p <prio> -d "desc"`
- `list-ready` → `bd ready --json`
- `list-attachments` → `bdw --sandbox hub attachments <id> --json`, run in the
  current workspace

## Errors

Errors follow the shape `{ code, message, details? }`. Common codes:

- `bad_request` – malformed payload or unknown type
- `not_found` – entity not found (e.g., issue id)
- `bd_error` – underlying `bd` command failed
- `attachments_unavailable` – `list-attachments` needs `BD_BIN` to be `bdw` and
  the current workspace to be a hub workspace (`projects/<code>/issues`)

## HTTP routes

### `GET /api/attachments/:id?path=<path>`

Serves one evidence file of issue `:id` from the current workspace (the one
`set-workspace` last chose, the same one the WebSocket handlers use).

- `:id` – the issue id; must match `^[A-Za-z0-9][A-Za-z0-9._-]*$`.
- `path` – exactly one query parameter: the row's `path` as `list-attachments`
  returned it, URL-encoded (for example
  `/api/attachments/bui-a1?path=attachments%2Ffix-bui-a1%2Flogin.png`).

The server runs the listing for `:id` (as `list-attachments` does) on every
request and serves the file only when a row has exactly this `path` and is not
`missing`, and the file's real path is inside the workspace root's real path.

`200`, body = the file bytes, with:

| File (by the row's `mime`)                           | `Content-Type`             | `Content-Disposition`           |
| ---------------------------------------------------- | -------------------------- | ------------------------------- |
| `image/png`, `image/jpeg`, `image/gif`, `image/webp` | the row's `mime`           | `inline; filename="<name>"`     |
| any other, `image/svg+xml` included                  | `application/octet-stream` | `attachment; filename="<name>"` |

`<name>` is the last segment of `path` (with `filename*=UTF-8''…` added for a
non-ASCII name). Every `200` also carries `X-Content-Type-Options: nosniff` and
`Cache-Control: no-store`.

`404` with an empty body and `Cache-Control: no-store` for every other request,
whatever the reason: an invalid `:id` (bdw is then never run), a missing, empty
or repeated `path`, a listing that is unavailable or fails, a `path` the listing
does not name for `:id` or names as `missing`, a path whose real location is
outside the workspace (`..`, symlinks), and a file that cannot be opened
(deleted after the listing, a folder).
