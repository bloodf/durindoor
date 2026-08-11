# Upstream PR Port — #3218 Model Limits (2026-08-11)

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [decolua/9router#3218](https://github.com/decolua/9router/pull/3218) `fix(models): expose snake_case token limits on /v1/models` | PORTED | `buildModelsList` exposed only nested `capabilities.contextWindow` and `capabilities.maxOutput`; OpenAI-compatible clients reading flat `/v1/models` limit fields could not discover either limit. | Emit `context_length` and `max_completion_tokens` for LLM outputs while retaining nested capabilities. Resolve absent/non-finite dynamic values against proven static/pattern limits via `resolveModelLimits`; never advertise the generic default floor as a guarantee. |

## Fork adaptation

Upstream changes `src/app/api/v1/models/route.js`. This fork has split model construction into `src/app/api/v1/models/buildModelsList.js`, so the limit attachment lives beside both static and connected-provider output construction.

**Divergence from upstream:** upstream falls back to a flat capability lookup with no distinction between a proven limit and a generic default. This fork instead calls `resolveModelLimits(providerId, modelId)` from `open-sse/providers/capabilities.js`, which reports a `known` flag alongside `contextWindow`/`maxOutput`. `DEFAULT_CAPABILITIES` (`contextWindow: 200000`, `maxOutput: 64000`) is the fork's generic floor for unmatched models — it is not evidence of a real provider guarantee, so `attachModelLimits` omits both top-level fields whenever explicit caps are absent/non-positive and `resolveModelLimits(...).known` is false. Explicit caps (live provider data or user-defined custom-model capabilities) still publish even for otherwise-unknown model IDs.

## Diff hunks

- `src/app/api/v1/models/buildModelsList.js`: add shared `attachModelLimits(model, providerId, modelId, explicitCaps)` helper; use it for static models, connectionless custom models, and connected LLM/image-to-text models. Static models pass merged static `caps`; connectionless custom models pass only `customCaps` (nested `capabilities` still merges static+custom); connected-provider models pass `explicitCaps` built from service-kind defaults, live catalog capabilities, and custom-model overrides, in that precedence order.
- `tests/unit/upstream-3218-model-limits.test.js`: cover static snake_case output + nested capability preservation, partial live-catalog capability merging against generic pattern limits (`ollama-local/gpt-5.6` → `400_000/128_000`, distinct from the OpenAI/Codex-specific `gpt-5.6` override), and an unknown connectionless custom model publishing only its explicit `contextWindow`/`maxOutput`.
- `docs/README.md`: link this ledger from Contributors.

## TDD verification

RED before source change:

```text
FAIL  tests/unit/upstream-3218-model-limits.test.js > buildModelsList — top-level context_length / max_completion_tokens (#3218) > emits snake_case top-level fields for static models and keeps nested capabilities
AssertionError: expected undefined to be 1000000 // Object.is equality
- Expected:
1000000
+ Received:
undefined
```

GREEN after source change (final, 3 assertions covering static/dynamic/custom-unknown paths):

```text
Test Files  1 passed (1)
Tests  3 passed (3)
Duration  3.73s
```

Regression check:

```text
Test Files  3 passed (3)
Tests  57 passed (57)
```
