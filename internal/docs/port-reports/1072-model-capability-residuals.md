# #1072 model capability residuals (#5354 #5355)

Ported 2026-11-20 from local base `10d3421060756ea426941915db96ba6d1a0970b6` (branch `orq/tornf6/port9r-model-capability-residuals-a1`). Sources: upstream [9router #5354](https://github.com/decolua/9router/pull/5354) (head `638d6fb4e014319723798524115867456ddb5b62`, 15-commit stack) and [9router #5355](https://github.com/decolua/9router/pull/5355) (head `15f08ab3c9e28843bcca048075077980c8579c1a`). Disposition follows the qualified review commit `389e7d8714e175e805dd71eaefa20ba3ad604342` ([1072-composite-open-residuals.md](https://github.com/bloodf/durindoor/commit/389e7d8714e175e805dd71eaefa20ba3ad604342)), residuals 5354-A and 5354-B only.

No provider request, browser session, credential, paid API or network fetch was made. All evidence is the upstream diffs, the local tree, and offline tests.

## Source disposition

| Source | Disposition | Evidence |
| --- | --- | --- |
| #5354 commit `cd929d10a3703922195b9c8bfb0c7566fa07e9ba` — `*qwen3.8*flash*next*` capability row at 262144/131072 | **Ported (adapted)** | The fork owns the same table in `open-sse/providers/capabilities.js` (`PATTERN_CAPABILITIES`, first-match-wins) and already ships the upstream `qwen-effort` format, so the upstream row transplants without a format change. See "Qwen 3.8 Flash-Next" below. |
| #5355 / #5354 commit `a4ac5ab6a9b9c98ad2461388d00b3fc39d72f71b` — MINIMAL floor for the tiered Gemini 3.6/3.7/3.8 Flash family | **Ported (adapted, provider-scoped)** | Upstream's mechanism is a provider-agnostic `PATTERN_THINKING` row in `open-sse/providers/thinkingLevels.js`. This fork's wire clamp reads `caps.thinkingEfforts` (`open-sse/translator/concerns/thinkingUnified.js:451-455`), so the effective module is the provider capability row, as the qualified review prescribed. Scoped to the direct Google lane — the provider whose own tier contract is `low|medium|high`. See "Tiered Gemini effort mapping" below. |
| #5354 commit `638d6fb4` residual C — tunnel/funnel port default (20128 vs 20127) | **Not applicable to this port** | Out of the assigned scope (no tunnel, deployment or Codex-header changes). The residual stays open in the composite review. |
| #5354 — Codex `OpenAI-Beta: responses=experimental` registry header | **Not applicable to this port** | Out of the assigned scope; the composite review records it as deferred pending a header-contract decision. |
| #5354 commits 02/15 + 05/15 — models.dev limit collection for every gateway-listed model | **Not applicable** | The fork has no `src/lib/modelCatalog`; limits resolve through `open-sse/providers/capabilities.js` and `src/lib/modelAutoSync/`. The same job is done by a different owner here. |
| #5354 commit 08/15 — Qwen 3.8 `reasoning_effort` route (`qwen-effort` format) | **Already shipped** | `open-sse/providers/thinkingLevels.js:36` declares `qwen-effort`, `open-sse/translator/concerns/thinkingUnified.js:482-488` maps the wire enum, and the fork's `*qwen3.8*` rows already use the format. |
| #5354 commit 12/15 — drop payload-less SSE frames | **Already shipped** | Recorded in [1072-stream-response-residuals.md](1072-stream-response-residuals.md) (`tests/unit/passthrough-sse-field-only-5441.test.js`). |
| #5354 upstream `*qwen3.8*` family-wide effort pin | **Deliberately not copied** | The fork's `qwen-effort` lanes already carry the official `none/low/medium/xhigh` set; a family-wide pin would also clamp third-party lanes that legitimately accept `minimal`/`high`, which needs its own scoping decision (the qualified review reached the same conclusion). |

## Behavior contract

### Qwen 3.8 Flash-Next — first-match capability metadata

Changed: `open-sse/providers/capabilities.js:974` adds one pattern row, placed between `*qwen3.8-2.4t*` and the generic `*qwen3.8*` row so first-match-wins keeps it reachable:

```js
{ pattern: "*qwen3.8*flash*next*", caps: { vision: true, videoInput: true, reasoning: true, thinkingFormat: "qwen-effort", contextWindow: 262144, maxOutput: 131072 } },
```

| Lane | Before | After |
| --- | --- | --- |
| Any gateway with no provider row and no synced-catalog overlay (`amd`, `vultr`, `requesty`, unregistered ids), `qwen3.8-flash-next` and vendor spellings (`Qwen3.8-Flash-Next`, `qwen3.8-flash-next@eu`) | `contextWindow: 1000000`, `maxOutput: 131072` | `contextWindow: 262144`, `maxOutput: 131072`; limit source stays `pattern` |

Unchanged (regression-protected in `tests/unit/model-capability-5354.test.js`):

- The hosted Qwen 3.8 API family keeps its 1M window: `qwen3.8-flash`, `qwen3.8-max` and `qwen/qwen3.8-max` stay `1000000`/`131072`.
- Sibling 3.8 weights keep their own rows: `qwen3.8-27b` → `262144`/`262144`, `qwen3.8-2.4t-a95b` → `262144`, `qwen3.8-omni-flash` → `262144`/`65536`.
- Provider-declared rows still win over patterns: `nan`/`qwen3.8-flash` stays `262144` with source `provider` and the `openai` thinking format.
- Explicit operator overrides still win over the pattern row: a `custom` override of context/output is returned as `custom`, and the live/cached override path is untouched.
- No other model's caps, modality flags, thinking format or level set changed.

### Tiered Gemini effort mapping

Changed: `open-sse/providers/capabilities.js:398` adds `GEMINI_FLASH_TIER_CAPABILITIES` and `open-sse/providers/capabilities.js:439-440` binds it to the direct Google lane's `gemini-3.7-flash` and `gemini-3.6-flash` rows, mirroring the existing documented `gemini-3.8-flash` row (`capabilities.js:437`).

| Lane | Before | After |
| --- | --- | --- |
| Direct Google `gemini` lane, `gemini-3.7-flash` / `gemini-3.6-flash` | `thinkingEfforts: null`; picker offers `minimal,low,medium,high`; `thinkingLevel: "MINIMAL"` could reach the wire | `thinkingEfforts: ["low","medium","high"]`; picker offers `low,medium,high`; a `minimal`/`none` intent or a sub-768-token budget floors to `thinkingLevel: "low"` |
| Same lane, explicit `low`/`medium`/`high` | passed through | passed through unchanged |
| Same lane, invalid level (`xhigh`, unknown spelling) | `high` | `high` (unchanged) |
| Same lane, limits and modality flags | `1048576`/`65536`, vision/audio/video/reasoning/search on | identical (the provider row republishes exactly what the family pattern row published, plus the tier set) |

Unchanged (regression-protected in the same file):

- The direct lane's documented 3.8 Flash row keeps `["low","medium","high"]` and still floors `minimal` to `low` with visible thoughts.
- Original Gemini 3 models keep their real MINIMAL tier: `gemini-3-flash-preview`, `gemini-3.1-pro-preview` and `gemini-3.5-flash` still resolve to `minimal` (the existing guard in `tests/unit/gemini-declared-thinking-efforts.test.js` still passes).
- The Antigravity tiered lane keeps its own row (`ANTIGRAVITY_FLASH_TIER_CAPABILITIES`), including its `thinkingFloorHidesThoughts` floor of `minimal`/`none` to `low` without thoughts.
- Reseller and third-party lanes keep their own contracts and are not floored: `openrouter`, `cheaperinference`, `github`, `opencode-zen` and `tokenrouter` still publish no declared effort set for `gemini-3.7-flash`.

## Evidence for the two decisions

### Qwen 3.8 Flash-Next window (262144 / 131072)

- Source: upstream commit `cd929d10` states that the open-weight flash-next preview is not on the hosted API line's 1M window — every models.dev lane (amd, requesty + `@eu`, tensorx, vultr) caps it at 262144 context, with 131072 output on the canonical listing (lanes diverge between 64000 and 262144). Upstream added the same row and a regression test in the same commit.
- Local corroboration: the fork has no registry row, no `MODEL_CAPABILITIES` row and no provider row for any `flash-next` id (no `flash-next` occurrence exists anywhere under `open-sse/` or `tests/`), so nothing in the fork contradicts the 262144 window.
- Why the pattern table decides alone here: the fork's shared models.dev snapshot is mapped per provider (`src/lib/modelAutoSync/sharedMetadata.js` `PROVIDER_SOURCES`: openai, codex, anthropic, claude, kimi, minimax, xai, gemini→google, github, ollama-cloud). A hand-added `amd`-style gateway is outside that map and outside the static registry, so it receives no synced-catalog overlay and the pattern row is the only limit it can see — the same reasoning upstream gives for its own `*qwen3.8*flash*next*` row.
- Why the hosted API family is protected: no hosted Qwen 3.8 id contains "next" (the registry lists `qwen3.8-flash`, `qwen/qwen3.8-flash`, `qwen3.8-max`, `qwen3.8-max-preview`, `qwen/qwen3.8-max`, `qwen3.8-27b`, `qwen/qwen3.8-27b`, `qwen3.8-omni-flash`, …), and provider rows outrank patterns anyway.
- Caveat: the 131072 output cap is upstream's canonical-listing value, not a value re-derived from a live models.dev snapshot in this port (no network or provider call was made). The 262144 context is the value every listed lane agrees on.

### Tiered Gemini effort mapping (low|medium|high)

- Source: upstream #5355 (also commit `a4ac5ab6` inside #5354) declares that the tiered `gemini-3.6/3.7/3.8-flash` models serve `low|medium|high` only and answer `400 "Thinking level MINIMAL is not supported for this model"`, and floors every minimal-producing intent (client `reasoning_effort: none|minimal`, a sub-768-token budget, a `(minimal)` model suffix, the none→minimal clamp for can't-disable models).
- Fork mechanism: the wire clamp reads the capability's declared effort set (`open-sse/translator/concerns/thinkingUnified.js:447-458`), so the provider capability row is the effective module — the disposition the qualified review recorded ("add `thinkingEfforts: ["low","medium","high"]` to the `gemini-3.7-flash` / `gemini-3.6-flash` rows, mirroring the 3.8 row").
- Scoping: the floor is applied to the provider whose own documented tier contract is `low|medium|high` — the direct Google lane, whose 3.8 Flash row is already declared that way from the ai.google.dev model page (`capabilities.js:428-437`). Resellers publish their own contracts and are left alone, which is also the fork's existing convention for the Antigravity tier rows ("Scoped to Antigravity; other providers keep their own metadata").
- Not reproduced live: the 400 was not re-observed in this port (no provider calls), matching the note already carried on the Antigravity tier row.

## Existing test touched

`tests/unit/antigravity-gemini4-catalog.test.js` asserted that `gemini`/`openrouter`/`cheaperinference` all publish no declared effort set for `gemini-3.7-flash`. Upstream's own #5355 moved its equivalent regression guard from a tiered model to `gemini-3-flash-preview` when it floored the tiered family. The guard is kept for the reseller lanes (`openrouter`, `cheaperinference`) and the direct lane's new contract is pinned in `tests/unit/model-capability-5354.test.js`; the Antigravity guard and the "direct gemini keeps its documented 3.8 Flash row" case are untouched.

## Files changed

- `open-sse/providers/capabilities.js` — one pattern row (Qwen flash-next) and two provider rows plus one shared constant (tiered Gemini 3.6/3.7 Flash).
- `tests/unit/model-capability-5354.test.js` — new offline capability/translation fixtures.
- `tests/unit/antigravity-gemini4-catalog.test.js` — reseller guard kept, direct lane moved to the new fixture file.
- `internal/docs/port-reports/1072-model-capability-residuals.md` — this report.

## Verification

Offline, from `tests/`, no network and no provider credentials:

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 \
  unit/model-capability-5354.test.js unit/shared-model-metadata.test.js
```

- `unit/model-capability-5354.test.js` + `unit/shared-model-metadata.test.js`: 2 files, 31 tests passed.
- Wider focused regression batch (capability, metadata and thinking paths): `unit/capabilities.test.js`, `unit/antigravity-gemini4-catalog.test.js`, `unit/gemini-declared-thinking-efforts.test.js`, `unit/upstream-3423-qwen38-muse.test.js`, `unit/model-metadata-resolution.test.js`, `unit/request-model-metadata.test.js`, `unit/vendor-capability-parity.test.js`, `unit/combo-capabilities.test.js`, `unit/strict-context-custom-caps.test.js`, `unit/combo-capability-ceiling.test.js`, `unit/live-model-limits.test.js`, `unit/buildModelsList-static-alias-map.test.js`, `unit/model-auto-sync-catalog.test.js`, `unit/param-support.test.js`, `unit/gemini-3.8-antigravity.test.js`, `unit/provider-thinking-config.test.js`, `unit/thinking-effort-openai-max-clamp.test.js`, `unit/thinking-openai-reasoning-cannot-disable.test.js`, `unit/adaptive-effort.test.js`, `unit/adaptive-effort-wiring.test.js`, `unit/opencode-thinking-effort.test.js`, `translator/thinking-unified.test.js`, `translator/gemma4-gemini.test.js`: 15 files, 332 tests passed.
- Root lint (`eslint src` plus the anti-slop gate): 0 diagnostics.

The full suite, the local CI gate and the upstream-watch domain were not run here; they belong to the integration owner. No baseline entry, workflow, `AGENTS.md`, generated index, secret or dashboard source was touched.
