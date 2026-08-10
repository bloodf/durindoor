# Upstream ADOPT-NOW Remainder — 2026-08-09

The three ADOPT-NOW commits from the plan's A2-b/A2-d groups that the earlier
batches did not land, plus the executor-family smoke the plan's final gate
requires. Anchors and the deferred list live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| Commit | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| `f260a181` `feat: Ollama Cloud quota tracker + proactive background OAuth refresh` | PORTED | `getOllamaUsage` was an informational stub returning a fixed message and `quotas: []`; the dispatcher passed `accessToken` even though Ollama Cloud authenticates with an API key. Nothing refreshed OAuth tokens outside an inbound request, so a credential with a short TTL (grok-cli is ~6h) expired while the router sat idle. | Read `ollama.com/api/usage` for session (5h) and weekly (7d) ratios, convert to 0–100 bars, and take the plan label from `/api/me` fail-open. Fix the dispatcher to pass `apiKey`/`providerSpecificData`/`proxyOptions`. Add `src/sse/services/backgroundTokenRefresh.js` plus the `ProviderLimits` normalization case. |
| `86131b9c` `feat(codex): support GPT-5.6 Max and Ultra overrides` | DUPLICATE | `thinkingLevels.js` already carries the Sol/Terra (`+ultra`) and Luna (`max`, no ultra) matrices, and `resolveOpenAiEffort` already implements the identical fallback chain — level supported → keep, `ultra` → `max` when available, else `xhigh`. The fork additionally maps `ultra → max` at the wire via `quirks.reasoningEffortAliases`, which upstream lacks. | No source change. Pinned with `tests/unit/codex-gpt56-effort-matrix.test.js` so the duplicate claim cannot silently rot. |
| `42c691b3` `feat(antigravity): show Gemini 3.6 Flash usage bars in quota tracker` | PORTED | The `importantModels` filter in `services/usage/google.js` had no 3.6 entries, so those tiers were dropped from the quota response. The fork's registry also did not expose the three 3.6 models at all, so adding quota rows alone would have advertised bars for models the router cannot route. | Add the three registry models with their tiered wire ids, then add the matching `importantModels` entries. |

## Adaptations

- **Boot wiring.** Upstream starts the scheduler from both `custom-server.js` and `initializeApp`. Only the `initializeApp` hook is ported: the scheduler is idempotent and fail-open, so one start site is sufficient, and `custom-server.js` is the highest-conflict surface in this fork (its own socket/IP hardening has diverged).
- **`checkAndRefreshToken` signature.** Upstream adds `options` as the third parameter; this fork already uses the third slot for `proxyOptions`. `force` became the fourth parameter so proxy routing is preserved.
- **Catalog drift guard.** `scripts/model-catalog-diff.mjs` requires every `upstreamModelId` to name a sibling catalog id — an invariant upstream does not enforce. Antigravity's tiered flash models are legitimately requested as `gemini-3.6-flash-tiered(high|medium|low)`, which is a wire-only name. The guard now exempts exactly that parenthesised-tier shape rather than being weakened for genuine typos, and the wire mapping is kept.
- **Superseded stub test.** `tests/unit/ollama-cloud-usage.test.js` asserted the old informational message. It now asserts the dispatcher forwards `apiKey` and `proxyOptions` and checks the exact quota/error shapes, with `proxyAwareFetch` mocked so the gate never reaches `ollama.com`.

## Executor-family smoke

`tests/unit/executor-family-smoke.test.js` drives each touched family and prints
the observed values:

| Family | Observed |
| --- | --- |
| Codex | `semantic=ultra wireEffort="max"` — ultra survives resolution and is mapped for the wire. |
| Ollama | `plan=Pro session={used:25,total:100,remainingPercentage:75} weekly={used:80,total:100,remainingPercentage:20}` |
| Antigravity | `quotas=["gemini-3.6-flash-high","gemini-3.6-flash-low"] high={used:200,total:1000,remainingPercentage:80}` |
| GitHub | `url=https://api.githubcopilot.com/chat/completions` with 13 auth/identity headers resolved. |
| Background refresh | `refreshAttempts=1` — only the due OAuth connection is refreshed; a far-future one and an apikey one are skipped, and a provider failure is swallowed. |

### Scheduler integration coverage

The scheduler's own suite injects `refreshConnection`, so it verifies selection
and fail-open behavior but never the default `refreshOne` path that production
runs. `tests/unit/background-token-refresh-integration.test.js` closes that gap
with the real path and only the network call and DB write mocked.

The case that matters: `github`'s on-request lead is 5 minutes while the
scheduler's is 30, so a token 10 minutes from expiry is scheduler-due but would
be skipped by the ordinary lead check. The test asserts `refreshProviderCredentials`
is called and the new token is persisted through `updateProviderConnection`.

Verified load-bearing two ways — both leave the tick green while refreshing
nothing, which is exactly the silent no-op this port risks:

- Dropping `{ force: true }` turns it red.
- Moving `force` into the third argument (upstream's slot, which this fork uses
  for `proxyOptions`) turns it red.

A live server on an isolated port and data directory additionally answered
`GET /v1/models` and drove `POST /v1/chat/completions` through the full request
pipeline to dispatch (failing only at the deliberately absent upstream with
`ECONNREFUSED`, which proves the pipeline ran).

## Verification

- `cd tests && npm run test:ci`: 6460 tests, 6400 passed, **0 failed**; `Raw failures: 0`, `Baseline additions check: no additions`.
- `npm run lint`: exit 0 (183 warnings, all pre-existing).
- `npm run build`: production build completed.
- `npm run check:docs`, `npm run check:registry-index`: passed.
- Revert proof: reverting `usage/misc.js` + removing the scheduler turns 13 of 15 Ollama/refresh tests red; reverting `usage/google.js` turns both Antigravity quota tests red.
