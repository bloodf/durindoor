# #1072 on-demand model capability probe

Reviewed 2026-11-20 against local base `b8071819175fff61e89124d676f770bc0ddf441a` (branch `orq/tornf6/port9r-on-demand-model-capability-probe-a1`), the dated [#1072 intake](https://github.com/bloodf/durindoor/issues/1072), the refreshed [#800 scan reconciliation](800-scan-reconciliation.md), and the earlier local disposition in [`1072-large-deferrals.md`](1072-large-deferrals.md). Upstream and issue metadata were read on 2026-11-20. No provider request, browser, Docker or live account was used; every check below is an offline mock or a static file read.

## Sources and dispositions

### [#5465](https://github.com/decolua/9router/pull/5465) — measure real model capability with probe requests — **adapted, one-model slice**

- **Upstream state.** OPEN, not draft, `mergedAt: null`, base `master`, head `5bc8e08ad0b329cde7520f9fc08f2641f1639f9a`, 11 files, +1,678/−2. Eligible: it is not closed-unmerged. Upstream `master` head `1855aa44473e88feac9d3f131b9c0c5fc9706b68` (2026-11-12) contains `src/app/api/models/test/` but **no** `src/app/api/models/probe/` and **no** `src/lib/probe/`, so the change is not already incorporated on the default branch.
- **Dated triage.** The 2026-11-19 [#1072 triage comment](https://github.com/bloodf/durindoor/issues/1072#issuecomment-7022000741) records #5465 as **port-candidate**, "Not found in pinned upstream range or port ledger; diff: `src/app/api/models/probe/capabilityProbe.js`, `src/app/api/models/probe/route.js`, `src/lib/probe/filters.js` (+8 files)", size large, risk high. The 2026-11-20 follow-up comment scopes it to "scoped follow-ups for **existing provider capability checks**". The refreshed [#800](800-scan-reconciliation.md) row reads: "Model capability probing; compare current probe filters and test coverage."
- **Earlier local disposition.** [`1072-large-deferrals.md`](1072-large-deferrals.md) called it "applicable gap" but "no offline-only acceptance command", and asked for owner decisions on eligible providers, per-call consent/cost notice, persistence/retention and automatic retry policy.
- **Qualification answer: yes, an existing authorized probe surface can carry a user-triggered single-model capability check.** The fork already owns one: `POST /api/models/test` with `{ model, kind, connectionId }`, backed by `pingModelByKind` in `src/app/api/models/test/ping.js`. It is single-model, it runs one ordinary provider operation, it pins an account through `x-connection-id`, and pinning is operator-only (`isOperatorRequest`). Upstream's own route comment says it chose a *separate* route to avoid changing that `{ model, kind }` contract and its dashboard callers. Adapting that existing action is therefore both the smaller change and the one that preserves account scope.
- **Adapted slice.** `POST /api/models/test` accepts an optional `check`. With `check: "tools"` the probe sends **one** normal chat-completions request that carries a single tool definition, then reports what the provider actually did. The response adds a `capability` object (`check`, `evidence`, `supported`, `detail`, `declared`, `request`, `cost`) and changes nothing else: without `check`, the request body and the response shape are byte-identical to before. The route keeps its five dashboard callers (`ModelsCard.js`, `AddCustomModelModal.js`, `providers/[id]/page.js`, `CompatibleModelsSection.js`, `PassthroughModelsSection.js`) on their existing contract.
- **Verdict semantics.** `supported` is three-valued on purpose. `true` (provider returned a `tool_call`), `false` (the provider refused the tool-carrying request with a client error), `null` (no evidence: the request failed for a credential, quota, timeout, not-found or server reason, or the provider accepted it and answered without calling the tool). A 401/403/429/5xx is **never** reported as "this model cannot call tools". Upstream's binary `capabilities.tools` flag collapses those cases; the fork keeps them apart.
- **Preserved behaviors.** Account scope is the selected connection's, exactly as the reachability test already uses it, and a non-operator still cannot pin one. The web-session skip guard (`SKIPPED_WEB_SESSION_ERROR`) still applies. `max_tokens: 1024` is reused from the existing chat probe (issue #3010), so a tools check costs no more than the plain reachability probe it replaces. The empty-content verdict is unchanged for a plain probe; it is relaxed only for a capability check that received a `tool_call`, because such an answer has no prose content by definition.
- **Rejected upstream scope.** The upstream store (`src/lib/probe/store.js`), the sweep scheduler and per-provider concurrency, `needsProbing` re-probe/retry rules, the picker filter chips, `ProbeBadge`, the `useModelProbes` hook and the optional audio pass are **not** ported. They need a persisted verdict store, a background sweep and a retry policy — exactly what this work order excludes. The upstream picker filters (`probe:ok`, `probe:rate_limited`, `probe:failed`, `probe:vision`, `probe:tools`, `probe:audio`) and its Detect sweep have no counterpart in the fork's model picker, which has no verdict to filter on.
- **Files.** `src/app/api/models/test/capabilityCheck.js` (new), `src/app/api/models/test/ping.js`, `src/app/api/models/test/route.js`, `src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js`, `src/app/(dashboard)/dashboard/providers/[id]/page.js`, `tests/unit/model-capability-check-5465.test.js` (new), `docs/guides/models-and-aliases.mdx`, `docs/reference/management-api.mdx`.

### Blocked slice of #5465 — the vision probe

Upstream measures vision with a second request that carries a 1×1 PNG. The fork **cannot** measure vision through the gateway, so that part is documented rather than landed.

`stripUnsupportedModalities` (`open-sse/translator/concerns/modality.js`) removes image blocks before translation for every model whose **declared** caps say `vision: false`, replacing them with a text placeholder. A gateway-level vision probe would therefore observe the local declaration, not the provider: a model declared non-vision would have its image stripped, answer normally, and be recorded as "vision confirmed". The same trap applies to `pdf`, `audioInput` and `videoInput`.

Measuring a modality honestly needs a provider-direct contract that bypasses modality stripping, or a probe that reaches the provider without the gateway's capability-driven rewrite. That is a separate provider behavior contract and a separate work order. `check: "vision"` is therefore refused with HTTP 400 rather than answered with a misleading verdict, and `SUPPORTED_CAPABILITY_CHECKS` contains only `tools`.

Tools are not affected: the fork does not strip tool definitions based on declared capabilities (only empty `tools` arrays are removed, in `open-sse/translator/formats/openai.js` and `open-sse/translator/formats/claude.js`, plus TTS models in `open-sse/handlers/chatCore.js`), so a tool definition reaches the provider unchanged and the provider's own answer is observable.

### Successor and sibling check

- No successor exists for #5465 on upstream `master`; the change is not on the default branch and no merged PR carries it.
- [#3842](https://github.com/decolua/9router/pull/3842) ("feat(responses): add native capability probe and routing gating", OPEN, 2 files: `open-sse/providers/registry/opencode-go.js`, `src/lib/formatProbe.js`) is a **different** feature, not a successor: it is a Responses-native format probe for one provider with routing gating. Its gating half is out of scope for this work order, which forbids using probe verdicts for routing or admission.
- [#3841](https://github.com/decolua/9router/pull/3841) is closed unmerged and therefore ineligible.

## Local state this port relies on

| Behavior | Location |
| --- | --- |
| Single-model probe route and operator-only account pin | `src/app/api/models/test/route.js` |
| Per-kind normal provider operations | `src/app/api/models/test/ping.js` |
| Web-session probe skip | `src/lib/providers/conversationProbe.js` |
| Declared capability table | `open-sse/providers/capabilities.js` |
| Gateway capability-driven media stripping (why vision is blocked) | `open-sse/translator/concerns/modality.js` |
| Provider error status surfaced to the caller | `open-sse/handlers/chatCore.js` |
| Declared-vs-measured row the check extends | `src/app/(dashboard)/dashboard/providers/[id]/ModelRow.js` |

## Verification

Offline only, with a mocked gateway. No provider call, no browser, no Docker, no full-suite run.

- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/model-capability-check-5465.test.js unit/model-test-routing.test.js` — 33 passed. Covers: exactly one tool-carrying request; a `tool_call` read as confirmed (including the empty-content case); a client error read as a rejection; 401/403/429/500/404 read as no evidence; an accepted request without a `tool_call` read as unproven; declared value reported next to the measured one; request and cost semantics exposed; account scope preserved; non-operator pin still refused; unsupported, empty and non-string `check` refused without probing; a non-chat kind refused; and the plain probe contract left untouched when no check is requested.
- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/1300-v5-storybook-inventory.test.js unit/combo-capabilities.test.js unit/combo-capability-detection.test.js unit/api-key-provider-account-scope.test.js unit/model-capability-check-5465.test.js unit/model-test-routing.test.js unit/ping-web-session-skip-14818.test.js unit/custom-model-modality.test.js unit/provider-readiness-switch.test.js unit/compatible-model-batch-identity.test.js` — 109 passed (10 files), including the four protected files.
- `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/provider-detail-icon-paths.test.js unit/provider-test-unavailable-contract.test.js unit/provider-readiness-ui.test.js unit/1300-v5-ui.test.js unit/network-nodes-ui-status.test.js unit/g2-edit-compatible-feedback.test.js unit/catalog-discovery-status.test.js unit/auto-ping-api.test.js` — 82 passed (8 files) for the dashboard surfaces the change touches.
- `npx eslint src` — 0 errors. `npm run lint:anti-slop` — 0 diagnostics across 2,661 files. `node scripts/check-docs.mjs` — passed.

### Dashboard inventory

The dashboard changed, so the inventory was regenerated with a static Storybook build and the checked-in generator, using private disk-backed scratch (`HOME`/`TMPDIR` under a 0700 scratch directory, build output written to the scratch tree rather than the repository):

```bash
npx storybook build -o "$SCRATCH/storybook-static" --quiet
node scripts/sync-storybook-inventory.mjs --index "$SCRATCH/storybook-static/index.json" --write
```

The manifest diff is only the source hashes of `ModelRow.js` and `page.js` plus their scenario hash entries (20 lines). Approved records are preserved exactly: 273 approved rows before and after, 0 lost, 0 new, 14 approved reference stories unchanged. No new approval was claimed, and the two affected rows were already `pending`, so they stay pending proposals.

## Limits

The check proves what one provider did with one tool-bearing request at one moment. It does not prove the model is reliable, that it calls the tool correctly, or that the account stays entitled. A verdict is display evidence for diagnosis; it is not written to the capability table, not stored, and not consulted by routing, admission, combo selection or the model picker. The probe is never scheduled, retried or swept, and the batch probe route (`/api/models/test/batch`) was deliberately left without a `check` option so no sweep surface was introduced.

The declared-vs-measured contrast is available for `tools` only. Vision, PDF, audio and video remain unmeasured for the reason recorded above, and no declaration was changed to imply otherwise.
