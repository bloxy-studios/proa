# Known gaps — Proa v0.1

An honest ledger of what is *not* done, what is stubbed, and what is verified where. Kept
current per the mission's "ship an honest v0.1" rule. Nothing here is hidden behind marketing.

## Build-machine constraints (the big one)

v0.1 was built on a headless Linux sandbox with **no display, no root, and no `xvfb`**, so the
Electron desktop app cannot be launched or packaged there (ADR-0007). Consequences:

- **Verified locally (sandbox):** the entire engine-agnostic surface — `@proa/protocol`,
  `extractor`, `permissions`, `traces`, `core` (incl. the jsdom `DomEngine`), `sdk`, `cli`, `mcp`,
  the fixture site, and the **full 5-task agent benchmark on MockProvider** — via
  `pnpm verify` + `pnpm --filter @proa/benchmark bench`. The CLI (`run`, `trace ls/replay/export`)
  and typed extraction are smoke-tested here too.
- **Verified in CI, not on the build machine:** the Electron app's runtime, the Playwright-on-Electron
  e2e, the captured live screenshots, and the packaged `.app`. The `apps/browser` code **typechecks**
  (`pnpm --filter @proa/browser typecheck`) and is architecturally faithful, but its *runtime* has
  not executed on the build machine. Treat the macOS CI job + release job as the source of truth for
  the GUI. If you are packaging locally on a Mac, follow `pnpm --filter @proa/browser package`.
- **README screenshots** (`docs/screenshots/*.png`) were rendered from the **real renderer
  stylesheet** (`apps/browser/src/renderer/styles.css`) with representative markup, in a real
  browser — they are honest depictions of the actual UI design, not mockups, but they are not yet
  live captures from the running Electron app. The CI `app` job captures live screenshots via the
  e2e harness and uploads them as artifacts.

## Stubs & partial implementations

- **`download` is gated but stubbed.** The `download` capability is classified, permission-checked,
  and ledgered correctly, but `dispatch()` returns `{ quarantined: true }` without writing bytes to
  a quarantine directory. The security-relevant part (the gate) is real; the file plumbing is v0.2.
- **`detectHidden()` reads inline `style`, class names, and attributes only.** It cannot see
  rules from external/`<style>` stylesheets, so an element hidden purely by a CSS *rule* (rather than
  inline style, `hidden`, `aria-hidden`, or an off-screen inline style) is not flagged as hidden. The
  imperative-pattern taint check still applies to visible text.
- **Per-Space cookie isolation ships only in the Chromium engine.** `ChromiumEngine` uses
  `session.fromPartition("persist:proa-<space>")` for real container isolation; the headless
  `DomEngine` has no cookie jar (it fetches/loads HTML). Per-Space **grant** isolation is enforced
  and unit-tested in both.
- **MCP HTTP surface is Proa's JSON bridge, not the MCP streamable-HTTP transport.** The standard
  **stdio** transport (what Claude Code uses locally) is the real MCP server via
  `@modelcontextprotocol/sdk`. The HTTP path is a token-gated `POST /call` bridge (used by the SDK's
  `connect()` and `curl`). Wiring the MCP streamable-HTTP transport is a v0.2 item.
- **MCP-opened tabs aren't listed in the app sidebar.** When Claude Code drives the live app, its
  tabs are real visible `WebContentsView`s but are tracked by the MCP session, not the UI tab model.
- **Heuristic schema mapping** covers the shapes that matter for v0.1 (HTML tables → the golden path,
  repeated list items, single objects). Model-assisted mapping (when a key is configured) is designed
  for in the extractor's confidence signal but not yet wired end-to-end; the heuristic is the default.
- **`askHuman` in headless mode** returns a structured `needs-human` outcome (it does not block). In
  the app it surfaces as a permission-style prompt only for permissioned actions, not arbitrary
  questions yet.

## Providers

- **Anthropic / OpenAI providers are implemented but exercised only via local smoke.** CI never uses
  a live model (ADR-0006) — it runs on `MockProvider`. On the build sandbox the ambient
  `ANTHROPIC_API_KEY` is a platform credential that returns 401 against `api.anthropic.com`, so the
  live path is validated by code review + typecheck, not a live call here.

## Tests we'd add next

- Unit coverage for `ChromiumEngine`'s CDP serializer/adapter (currently only typechecked).
- An SDK `connect()` integration test against a live `proa mcp serve --http` (the bridge is unit-
  tested; the round-trip is not).
- Expanded injection red-team fixtures (more evasion techniques) beyond the single trap task.
- Golden test for the MCP tool list is present (`@proa/mcp`); add one asserting the SDK↔MCP↔CLI verb
  sets stay in lockstep.

## Not in scope for v0.1 (by design, not omission)

See the non-goals in `README.md`: no Chromium fork, no extension compatibility, no accounts/sync/
cloud, no monetization/mobile, macOS-first packaging.
