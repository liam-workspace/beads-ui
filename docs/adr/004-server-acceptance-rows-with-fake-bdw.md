# ADR 004 — Server Acceptance Rows With a Fake bdw

```
Date: 2026-10-15
Status: Accepted
Owner: agent
Decision: BUI-001 D-06
```

## Context

The server's existing tests mock `server/bd.js` with `vi.mock`, so they never
exercise the real HTTP app, the real WebSocket server or the process boundary to
`bd`. Story BUI-001 adds a WebSocket message (`list-attachments`) and an HTTP
route (`GET /api/attachments`) whose rules (which files are listed, which paths
are refused, what content type is sent) must be pinned at the server, below the
browser tests. beads-ui has no database, so a database-backed integration suite
does not apply.

## Decision

- Server acceptance rows are Vitest tests in the node environment, in
  `server/<feature>.acceptance.test.js` (first:
  `server/attachments.acceptance.test.js`).
- Each suite starts the real `createApp` and `attachWsServer` on `127.0.0.1:0`
  and talks to them over HTTP and WebSocket like a client.
- `bd` / `bdw` is replaced at the process boundary, not by module mocking: a
  fake binary from `test/fake-bdw.fixture.js`, selected through `BD_BIN`, reads
  its answers from a per-world `state.json` and records every call so a row can
  assert what the server asked for.
- Each row carries a stable ID in its title (`A-01`, `F-01`, …) so one row runs
  with `pnpm exec vitest run <file> -t "<row id>"`.
- Rows are written before the feature is built and stay red until it lands; once
  the contract is fixed they are changed only to follow a recorded decision.

## Consequences

- Server behaviour is proven through the same interfaces the browser uses, with
  the real argument handling and process spawning.
- The rows run in the normal `pnpm test` suite; they need no database, network
  service or hub.
- The fake binary is shared with the Playwright E2E harness (ADR 003), so the
  two levels agree on what `bd` / `bdw` returns.
- Existing `vi.mock`-based unit tests stay; acceptance rows sit above them and
  do not replace them.
