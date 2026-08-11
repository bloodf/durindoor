# Upstream PR Ports — #3204, #3210, #3213 (2026-08-10)

Three `decolua/9router` pull requests that were still OPEN when ported. Each was
verified against this fork before implementing, matching the D1 batch's bar
rather than waiting for the merged diff. Anchors live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3204](https://github.com/decolua/9router/pull/3204) `fix(system-inject): use chat-compatible content part type for array system messages` | PORTED | `open-sse/rtk/systemInject.js:116` pushed a Responses-only `{type:"input_text"}` part into **any** array-shaped system message. Strict chat providers (StepFun) answer `400 Unrecognized chat message`, so a CAVEMAN-enabled request failed outright whenever the client sent array system content. | Thread the existing `isResponses` flag into `appendToOpenAIMessage` so chat `messages[]` gets `{type:"text"}` and Responses `input[]` keeps `input_text`. Tests in `tests/unit/system-inject-chat-array.test.js`. |
| [#3213](https://github.com/decolua/9router/pull/3213) `fix(auto-ping): select Codex model from live catalog` | PORTED | `config.js` hardcoded `pingModel: "gpt-5.5"`, which 400s on a plan that does not expose it. Worse, three separate gates keyed quota resources by that stale model, so the preflight could consult a different window than the one the ping would consume. | Add `getCodexModels` (live catalog, priority-ordered, fail-open) plus the registry `modelsUrl`/`clientVersion`. Resolve the model from the account's catalog and skip the ping when the catalog is empty. Remove the hardcoded `pingModel` and update all three tooltips (two dashboard, one CLI). Tests in `tests/unit/codex-models.test.js` and `tests/unit/quota-auto-ping.test.js`. |
| [#3210](https://github.com/decolua/9router/pull/3210) `feat(dashboard): show effective Codex plan badges` | PARTIAL DUPLICATE — gap ported | The fork already had the shared `getCodexPlanLabel` helper and hid empty/`unknown`, so the badge itself existed. But **neither view implemented live-first/stored-fallback**: `ConnectionRow.js` read only stored `chatgptPlanType`, and `ProviderLimits/index.js` read only `quota?.plan`, so an unavailable or `unknown` live read showed no badge at all. | Add `getCodexPlan(quota, connection)` (live wins, stored is fallback) and use it in the quota view. Give `ConnectionRow` a `plan` prop with the same precedence, and fetch live plans per Codex connection on the provider page. Tests in `tests/unit/codex-plan-badge.test.js`. |

## Adaptations

- **#3213 gate ordering.** Upstream resolves the model just before dispatch, which still leaves two earlier model-scoped gates reading the stale default. Here the early preflight and the early `hasBlockingLongWindow` are made model-agnostic for Codex (the catalog is not known until after the connection reload), and the single model-scoped window check runs once, with the selected model, immediately before dispatch.
- **#3213 signature.** `sendCodexPing` takes the resolved `model`; `getCodexModels` reuses this fork's `buildCodexHeaders` (which already applies the account binding and `idToken`) rather than upstream's inlined header block.
- **#3204 Responses routing.** Plain `openai-responses` routes to top-level `instructions` in this fork — only the Responses **Lite** shape (recognised by the `additional_tools` envelope) appends into `input[]`. The tests assert against the Lite shape accordingly; upstream's flat `input[]` assumption does not hold here.
- **#3210 race.** The provider page computes plans **before** any `setState`, then commits connections, names, and plans together after a single staleness check. Setting rows first and bailing after the usage fetch would leave a switched-away provider's connections rendered.

## Verification

- `cd tests && npm run test:ci`: `Raw failures: 0`, `Baseline additions check: no additions`.
- `npm run lint`: exit 0 (pre-existing warnings only). `npm run check:docs`: passed.
- Revert proof, each confirmed red then green:
  - #3204 — restoring the unconditional `input_text` fails the chat-array case.
  - #3213 — replacing the catalog lookup with the old fixed model fails both the dispatch-model and empty-catalog cases; substituting `gpt-5.5` into the model-scoped window check fails the exhausted-window case. That last fixture is deliberately model-scoped (`resourceKey: "model:gpt-5.6-terra"` exhausted, `model:gpt-5.5` available) so it cannot pass on a generic account-scoped window.
  - #3213 — removing `getCodexModels` fails all seven catalog tests.
