# Port log: OmniRoute PR #6890

- **Source:** https://github.com/diegosouzapw/OmniRoute/pull/6890 (fixes upstream issue #6772)
- **Port branch:** `port/omniroute-6890`
- **Preflight:** `stripRedundantNodePrefix` absent on `origin/dev@397d54b6a4`; runtime `src/sse/services/model.js` matched custom nodes by `node.prefix` only — raw-connId addressing fell through. Not a duplicate.

## Behavior ported

Custom OpenAI/Anthropic-compatible provider nodes addressed by raw internal connection id (`<connId>/<modelStr>` — e.g. a combo step) now resolve identically to the bare alias form (`<prefix>/<modelStr>`). A caller that naively concatenates `owned_by` (the node prefix, as listed by `/api/models`) with the listed model id produces `<connId>/<prefix>/<rawModelId>`; the redundant leading `<prefix>/` segment is stripped so the upstream provider receives the registered raw model id instead of a double-namespaced id that 400s.

## DurinDoor adaptation

- `stripRedundantNodePrefix(model, nodePrefix)` exported from `open-sse/services/model.js` (pure helper; removes exactly one leading `${prefix}/` segment, no-op on non-string/absent prefix or non-matching segment).
- Runtime `getModelInfo` in `src/sse/services/model.js`: OpenAI-compatible and Anthropic-compatible node matching extended from `node.prefix === providerAlias` to `node.prefix === providerAlias || node.id === providerAlias`, and the returned `model` passes through `stripRedundantNodePrefix` with the matched node's prefix. `custom-embedding` matching left unchanged (upstream diff covered OpenAI/Anthropic paths only). Built-in reserved prefixes still take precedence over node prefixes (existing `RESERVED_PROVIDER_PREFIXES` guard).
- Upstream's `lookupCustomModelMeta` indirection and TS types dropped; DurinDoor's runtime service returns `{ provider, model }` only.

## Files (4)

- `open-sse/services/model.js`
- `src/sse/services/model.js`
- `tests/unit/model-connid-prefix-normalization.test.js`
- `docs/ports/omniroute-6890.md`

## Verification

Focused test (5 cases: alias baseline, connId+raw, connId+prefix double-namespace, anthropic-compatible parity, non-matching `fta-x/` segment not stripped):

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/model-connid-prefix-normalization.test.js
Test Files  1 passed (1)
Tests       5 passed (5)
```

Red-check: with the fix stashed, the two connId-addressed cases fail (2 failed / 3 passed); with the fix restored all pass.

Regression (prefix-addressing behavior unchanged):

```text
cd tests && node node_modules/vitest/vitest.mjs run unit/model-connid-prefix-normalization.test.js unit/model-routing.test.js
Test Files  2 passed (2)
Tests       9 passed (9)
```

No full gates (lint/build/gen indexes/test:ci) run per port-unit constraints; orchestrator verifies at integration.
