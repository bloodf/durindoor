# Port log: upstream 9router PR #2580

- **Source:** https://github.com/decolua/9router/pull/2580 ("Improve Kiro direct session cache reuse")
- **Port branch:** `port/upstream-2580`

## Behavior ported

Kiro direct calls now reuse the upstream warm session cache across turns of a conversation: the executor stamps one stable `agentContinuationId` (plus `agentTaskType: "vibe"`, `agentMode: "vibe"`) per `(scope, connectionId, model, conversationId)` affinity tuple. The `conversationId` already derives from `resolveSessionId`, so continuation affinity inherits the client-session resolution chain. Reuse survives retry/fallback re-dispatch (BaseExecutor re-invokes `transformRequest` per URL attempt), while a continuation minted under one account, model, or session is never replayed for another — even when clients present identical explicit session ids.

## DurinDoor adaptation

The upstream PR bundles thinking-field remapping and a `kiroSessionReplay` module; this port takes only the session-cache reuse core. `resolveContinuationId` in `open-sse/utils/sessionManager.js` keeps a TTL/LRU-bounded continuation store keyed on the full `[scope, account, model, session]` JSON tuple; incomplete identity (missing account/model/session/scope) yields an unstored one-shot id rather than collapsing accounts into a shared bucket — never token/email-derived keys. `KiroExecutor.transformRequest` clones the translated payload and stamps the continuation identity; translators and `conversationId` resolution are unchanged.

## Files (4)

- `open-sse/executors/kiro.js`
- `open-sse/utils/sessionManager.js`
- `tests/unit/kiro-session-affinity.test.js`
- `docs/ports/upstream-2580.md`

## Verification

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/kiro-session-affinity.test.js unit/session-manager.test.js translator/claude-kiro-direct.test.js translator/bugs-kiro.test.js unit/openai-to-kiro.test.js unit/kiro-region.test.js unit/kiro-regions.test.js
Test Files  7 passed (7)
Tests       87 passed | 2 expected fail (89)
```

New affinity suite (12 cases): same tuple hit, changed session miss, cross-account isolation, cross-model isolation, retry/fallback stability, payload immutability, no-conversationId passthrough, one-shot on incomplete identity, store clear, `resolveSessionId` end-to-end wiring, and a translator→executor flow-through. Red-checked: 5 cases fail when the executor hook is reverted.
