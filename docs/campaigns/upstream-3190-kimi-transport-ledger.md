# Upstream PR Port — #3190 (2026-08-11)

`decolua/9router` pull request verified against this fork before implementing.
Anchors live in [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3190](https://github.com/decolua/9router/pull/3190) `fix(kimi): route API-key auth to Moonshot platform, not Kimi Code` | PARTIAL — gap ported, mechanism rejected | Upstream introduces a new `authType` field on `resolveTransport` entries to distinguish OAuth vs. API-key routing. This fork already solves the same problem: `chatCore.js:304-322` derives `apikeyTransportFormat = "openai-apikey"` from `credentials.authType === "apikey"` and `open-sse/providers/registry/kimi.js` already carries a distinct `openai-apikey` transport (Moonshot `https://api.moonshot.cn/v1/chat/completions`, Bearer). The registry and dispatch were already correct. The real gap: `src/app/api/providers/[id]/test/testUtils.js`'s `case "kimi":` connection-health-check probe still hit the Kimi Code subscription endpoint (`https://api.kimi.com/coding/v1/messages`, `x-api-key`) for *every* Kimi connection, including API-key ones — so testing an API-key connection validated against the wrong platform. | Point the health-check probe at the Moonshot platform endpoint (`https://api.moonshot.cn/v1/chat/completions`) with `Authorization: Bearer <key>`, matching the registry's `openai-apikey` transport. Did not port upstream's `authType` field — adding it to `resolveTransport` would create a second, competing auth-routing mechanism alongside `apikeyTransportFormat`. Test in `tests/unit/kimi-health-check.test.js`. |

## Adaptations

- **Rejected `authType` on `resolveTransport`.** Upstream's fix threads a new `authType: "apikey"` field through the transport-selection layer. This fork already routes API-key vs. OAuth Kimi traffic via `chatCore.js`'s `apikeyTransportFormat`, which strips the `-apikey` suffix before translator dispatch. Introducing upstream's field would duplicate that mechanism without adding capability — rejected in favor of the existing one.
- **Endpoint scope.** Upstream's chat-dispatch path (`open-sse/providers/registry/kimi.js`, `chatCore.js`) was already correct in this fork prior to this port. Only the standalone connection-health-check probe in `testUtils.js` (unrelated to `resolveTransport`) still pointed at the wrong host; that is the only line changed.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/unit/kimi-health-check.test.js`
  - RED (before fix): `AssertionError: expected 'https://api.kimi.com/coding/v1/messag…' to be 'https://api.moonshot.cn/v1/chat/compl…'`
  - GREEN (after fix): `Test Files 1 passed (1)`, `Tests 1 passed (1)`.
- Full suite / lint / docs check left to the parent (per campaign constraints, this worktree only runs its focused test).
