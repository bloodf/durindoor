# Port log: upstream 9router PR #2590

- **Source:** https://github.com/decolua/9router/pull/2590
- **Port branch:** `port/upstream-2590`

## Behavior ported

The official `@xai-official/grok` 0.2.99 client talks to `cli-chat-proxy.grok.com` with a `grok-shell` fingerprint and, for the Grok Build subscription model, omits the legacy grok-pager headers (`x-xai-token-auth`, `x-authenticateresponse`, `x-compaction-at`) and never sends `reasoning.effort` — while still requesting `reasoning.encrypted_content` for store=false multi-turn continuity. Requests whose resolved upstream model is `grok-build` are now re-fingerprinted at dispatch to match that captured 0.2.99 wire protocol.

## DurinDoor adaptation

Upstream switched the provider fingerprint globally; DurinDoor scopes the 0.2.99 fingerprint and header omissions to `grok-build` only, so non-Build Grok requests and auth keep the legacy 0.2.93 header path preserved. `buildHeaders` keys off `this._currentModel` (set in `transformRequest` after alias/effort-suffix resolution) — for `grok-build` it sets `User-Agent: grok-shell/0.2.99 (linux; x86_64)`, `x-grok-client-identifier: grok-shell`, `x-grok-client-version: 0.2.99` and deletes the three legacy headers. In `transformRequest`, `grok-build` strips only `reasoning.effort` (caller `summary` preserved, defaulting to `concise`) and the `reasoning.encrypted_content` include gate now triggers on `body.reasoning && effort !== "none"` so Build still gets encrypted-reasoning continuity. Upstream's new `config/grokCli.js` module, turn-store, tool-normalization, and model-discovery changes are NOT ported; fingerprint constants are inlined in the executor.

## Files (3)

- `open-sse/executors/grok-cli.js`
- `tests/unit/grok-cli-build-protocol.test.js`
- `docs/ports/upstream-2590.md`

## Verification

```text
cd tests && node node_modules/vitest/vitest.mjs run --config vitest.config.js unit/grok-cli-build-protocol.test.js
Test Files  1 passed (1)
Tests       4 passed (4)

Regression — existing grok-cli suites:
unit/grok-cli-2502.test.js unit/grok-cli-strip-params.test.js unit/grok-cli-usage.test.js
Test Files  3 passed (3)
Tests       30 passed (30)
```
