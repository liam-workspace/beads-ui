# ADR 003 — Playwright E2E Against the Real Server and a Fake bdw

```
Date: 2026-10-15
Status: Accepted
Owner: agent
Decision: BUI-001 D-05
```

## Context

beads-ui had no browser tests. Its Vitest suites run the front end in jsdom,
which has no top-layer `<dialog>`, no Escape-to-`cancel` on a nested dialog, no
image decoding and no downloads. Story BUI-001 (screenshot gallery) needs one
browser test per acceptance scenario, and several of those scenarios depend on
exactly the behaviour jsdom lacks.

Running the real `bdw` in tests is not an option: it needs the projects hub and
a running Beads server.

## Decision

- `@playwright/test` (exact version pinned in `package.json`, Chromium only) is
  the browser E2E runner.
- `playwright.config.js` at the repository root; specs are `e2e/*.spec.js`,
  named after the story (`e2e/BUI-001-screenshot-gallery.spec.js`); helpers live
  in `e2e/support/`.
- Two `webServer` entries, both started by `e2e/support/start-server.js` with
  the real `server/` code:
  - `--flavour bdw` on `E2E_WEB_PORT` (default 5174), the main target;
  - `--flavour bd` on `E2E_API_PORT` (default 3001), for behaviour that only
    applies when the server runs plain `bd`.
- Each server runs against a fake binary from `test/fake-bdw.fixture.js`
  (selected through `BD_BIN`), which records every call and answers from a
  per-world `state.json`. The same fixture serves the server acceptance rows
  (ADR 004).
- One worker, no retries, `forbidOnly`. One mode only: there is no mock mode and
  no `E2E_MODE` switch.
- The launcher refuses to start while `app/main.bundle.js` exists, because the
  server would serve the stale bundle instead of the current source.
- Run with `pnpm exec playwright test`; a targeted run passes the spec files
  touched since the base commit.

## Consequences

- Dialogs, keyboard handling, image loading and downloads are proven in a real
  browser instead of being approximated in jsdom.
- Contributors need the Chromium build Playwright installs
  (`pnpm exec playwright install chromium`).
- E2E runs never touch a real Beads database or the hub.
- The fake binary is the single description of what the server may ask `bd` /
  `bdw`; a new server call needs a matching answer in the fixture.
- `@playwright/test` is a development dependency only; it is not shipped in the
  npm package.
