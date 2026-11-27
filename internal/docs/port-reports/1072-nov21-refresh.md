# #1072: Disposition 9router PRs updated 2026-11-21

Reviewed 2026-11-21 against DurinDoor current head. Source PR inventory from upstream `decolua/9router` covers new PR #5798, updated re-pins for #5796, #5787, #5786, #5780, #5679, and #4704, and closed unmerged PR #5734. Source PRs were inspected using configured GitHub read tools and public pinned Git objects without executing upstream code.

## Summary table

| PR | Title | Pinned head SHA | State | Disposition | Details / Local components |
| --- | --- | --- | --- | --- | --- |
| [#5798](https://github.com/decolua/9router/pull/5798) | feat(dashboard): revamp Console Log viewer with filters and structured rows | `28850c4414df26ff534af9a2b927e9dcc42c5184` | Open | **port** | DurinDoor has the Console Log viewer ([src/lib/consoleLogBuffer.js](../../../src/lib/consoleLogBuffer.js), src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js); revamp provides structured entries, filtering, and live counters. |
| [#5796](https://github.com/decolua/9router/pull/5796) | fix(codebuddy): sanitize only agent identity lines in system prompts to preserve user rules | `4ce887685c2ed0431c71fdd74544f2378023761c` | Open | **port** | DurinDoor has both executors ([open-sse/executors/codebuddy-cn.js](../../../open-sse/executors/codebuddy-cn.js), [open-sse/executors/codebuddy-intl.js](../../../open-sse/executors/codebuddy-intl.js)); line-level sanitization preserves project instructions and user rules >2000 chars. |
| [#5787](https://github.com/decolua/9router/pull/5787) | fix(antigravity): fix Gemini 4 & Claude 5.5 model IDs and thinking mappings | `6ceccc1bf0a7074ac542e4119500a696b247d372` | Open | **already in** | Registered in [open-sse/providers/registry/antigravity.js](../../../open-sse/providers/registry/antigravity.js), [open-sse/config/providerModels.js](../../../open-sse/config/providerModels.js), [open-sse/providers/thinkingLevels.js](../../../open-sse/providers/thinkingLevels.js), and [open-sse/translator/concerns/thinkingUnified.js](../../../open-sse/translator/concerns/thinkingUnified.js). |
| [#5786](https://github.com/decolua/9router/pull/5786) | fix(custom-provider): publish the configured prefix, not the node id | `efbe45057816b197220135bcaf71cd1dc52c9523` | Open | **already in** | Implemented in [src/shared/utils/providerPrefix.js](../../../src/shared/utils/providerPrefix.js) (`resolveProviderPrefix`), src/app/(dashboard)/dashboard/playground/playgroundHelpers.js, and [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js). |
| [#5780](https://github.com/decolua/9router/pull/5780) | feat(nvidia): support Kimi K3.1 Pro, Step 5 Preview and the live NIM catalogue | `3b2341aa6eb0236b2171959ce418e0ce7f3166e2` | Open | **already in** | Chat models registered in [open-sse/providers/registry/nvidia.js](../../../open-sse/providers/registry/nvidia.js) keeping default head `meta/llama-3.3-70b-instruct`; discovery configured in [src/app/api/providers/[id]/models/modelsConfig.js](../../../src/app/api/providers/[id]/models/modelsConfig.js). |
| [#5679](https://github.com/decolua/9router/pull/5679) | feat(antigravity): add gemini-4-hydrogen model tiers and quota tracking | `db38def648cc6776592ef7da850cd1944198cdfd` | Open | **already in** | Hydrogen tiers registered in [open-sse/providers/registry/antigravity.js](../../../open-sse/providers/registry/antigravity.js) and quota tracking in [open-sse/services/usage/google.js](../../../open-sse/services/usage/google.js). |
| [#4704](https://github.com/decolua/9router/pull/4704) | feat(combos): add intelligence-managed model selection | `939bc2fcfc5e4f62b73cf1f2e9af1d1e4295d5d5` | Open | **not applicable** | Components DurinDoor lacks: external Artificial Analysis HTML scraping and score-managed combo router; DurinDoor uses local outcome-based smart scoring in [open-sse/services/combo.js](../../../open-sse/services/combo.js). |
| [#5734](https://github.com/decolua/9router/pull/5734) | fix(providers): use live per-account model catalog for antigravity | `f8afea66f3a99bab81245154e6bc6c2d3acc8f96` | Closed (unmerged) | **already in** | Implemented with account-scoped project RPC in [open-sse/services/catalogs/antigravityCatalog.js](../../../open-sse/services/catalogs/antigravityCatalog.js) and [src/app/api/providers/[id]/models/modelsConfig.js](../../../src/app/api/providers/[id]/models/modelsConfig.js). |

---

## Detailed PR Dispositions

### [#5798](https://github.com/decolua/9router/pull/5798) — feat(dashboard): revamp Console Log viewer with filters and structured rows

- **Upstream source**: [9router PR #5798](https://github.com/decolua/9router/pull/5798)
- **Pinned head SHA**: `28850c4414df26ff534af9a2b927e9dcc42c5184`
- **State**: Open
- **Comparison with existing dispositions**: New upstream PR; no previous review or disposition in `internal/docs/port-reports/`.
- **Disposition**: **port**
- **Analysis**:
  DurinDoor maintains the Console Log viewer component in [src/lib/consoleLogBuffer.js](../../../src/lib/consoleLogBuffer.js) and src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js. Currently, log lines are stored as raw strings and rendered in an unstructured terminal block where high-frequency background events (such as token refresh intervals) obscure request activity. Upstream PR #5798 introduces structured log capture (`seq`, timestamp, console level, text), a pure parsing utility `consoleLogFormat.js`, search/level/tag filters, live counters, pause/resume buffering, copy visible / `.log` download, and reconnect deduplication by `seq`. In chat response handlers, the `DONE` line is annotated with the routed model `${provider}/${model}`. Because DurinDoor ships this dashboard component and the change is a direct improvement, this is an approved port candidate.
- **Target files**:
  - [src/lib/consoleLogBuffer.js](../../../src/lib/consoleLogBuffer.js)
  - `src/shared/utils/consoleLogFormat.js` (new pure utility)
  - [src/shared/constants/config.js](../../../src/shared/constants/config.js)
  - src/app/(dashboard)/dashboard/console-log/ConsoleLogClient.js
  - [open-sse/handlers/chatCore/nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js)
  - [open-sse/handlers/chatCore/requestDetail.js](../../../open-sse/handlers/chatCore/requestDetail.js)
  - [open-sse/handlers/chatCore/sseToJsonHandler.js](../../../open-sse/handlers/chatCore/sseToJsonHandler.js)
  - [open-sse/handlers/chatCore/streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js)
  - `tests/unit/console-log-format.test.js` (new)
- **Acceptance**:
  Update `consoleLogBuffer.js` to store structured entry objects containing sequence number `seq`, timestamp `t`, captured console level `level`, and text `text`, while expanding `CONSOLE_LOG_CONFIG.maxLines` from 200 to 500. Introduce pure formatting and filtering functions in `src/shared/utils/consoleLogFormat.js` (`parseLogEntry`, `matchesLogFilters`, `countByLevel`, `collectTags`) to extract levels, tags (e.g. `TOKEN_REFRESH`, `BG_TOKEN_REFRESH`), model, routed model, format, latency, and tokens from log lines. Update `ConsoleLogClient.js` to support real-time search across model/account/tag/text, level filter toggles with live count badges, tag dropdown filtering, pause/resume buffering on an internal queue, line wrap toggle, copy visible rows, download `.log`, and merge incoming init snapshots by sequence number on EventSource reconnects. Update `formatDoneLine` in chatCore response handlers to log the routed model `${provider}/${model}`.
- **Focused tests to add**:
  `tests/unit/console-log-format.test.js` asserting entry parsing across request/response/background shapes, console level classification, tag extraction and sorting, symbol stripping, countByLevel and collectTags computations, sequence-based identity stability, and filter matching by level, tag, and search query.

- **Ported in this unit**: Added client-side request and completion field parsing and structured row summaries using the existing string log payload; existing filters, counters, pause/wrap/copy/download controls, snapshot reconciliation, and routed-model DONE logs already cover the remaining behavior. Kept the server buffer and log API string-compatible. `tests/unit/port9r-5798-console-log-viewer.test.js` covers request and completion fields and leaves unrelated lines untouched.

---

### [#5796](https://github.com/decolua/9router/pull/5796) — fix(codebuddy): sanitize only agent identity lines in system prompts to preserve user rules

- **Upstream source**: [9router PR #5796](https://github.com/decolua/9router/pull/5796)
- **Pinned head SHA**: `4ce887685c2ed0431c71fdd74544f2378023761c`
- **State**: Open
- **Comparison with existing dispositions**: Re-pinned at current head. No prior 9router disposition exists in `internal/docs/port-reports/`.
- **Disposition**: **port**
- **Analysis**:
  DurinDoor includes both executors in [open-sse/executors/codebuddy-cn.js](../../../open-sse/executors/codebuddy-cn.js) and [open-sse/executors/codebuddy-intl.js](../../../open-sse/executors/codebuddy-intl.js). In the current DurinDoor implementation, when an incoming request matches `AGENT_PATTERN`, `codebuddy-cn.js` replaces the entire system message content with `NEUTRAL_PROMPT`. Consequently, when agent harnesses (such as `opencode`, Claude Code, or Codex CLI) append project instructions, user rules, or `AGENTS.md` guidelines to the system prompt, all user rules are lost. Upstream #5796 replaces wholesale prompt replacement with line-level sanitization: only lines matching `AGENT_PATTERN` are neutralized (replacing the first matched identity line with `NEUTRAL_PROMPT` and stripping subsequent marker substrings), while non-matching lines remain intact regardless of length. It also extends developer role handling in `CodeBuddyExecutor`. This fixes a clear behavioral flaw in DurinDoor's existing components.
- **Target files**:
  - [open-sse/executors/codebuddy-cn.js](../../../open-sse/executors/codebuddy-cn.js)
  - [open-sse/executors/codebuddy-intl.js](../../../open-sse/executors/codebuddy-intl.js)
  - `tests/unit/codebuddy-intl-system-prompt.test.js` (or `tests/unit/port9r-codebuddy-system-prompt-5796.test.js`)
- **Acceptance**:
  In both `CodeBuddyExecutor` and `CodeBuddyIntlExecutor`, replace full system message replacement with line-level sanitization: scan system and developer message text, replace the first line matching `AGENT_PATTERN` with `NEUTRAL_PROMPT`, strip subsequent matching agent marker tokens, and keep all non-matching lines (such as `Instructions from: .../AGENTS.md` and repository rules) intact even when system prompts exceed 2,000 characters. Preserve typed content block arrays where present.
- **Focused tests to add**:
  `tests/unit/codebuddy-intl-system-prompt.test.js` (or `tests/unit/port9r-codebuddy-system-prompt-5796.test.js`) asserting that system prompts containing agent identity preambles (e.g. `You are an AI coding agent`) have only the identity line neutralized to `NEUTRAL_PROMPT` while appended `AGENTS.md` rules (>2,000 chars) and custom instructions are preserved across both `codebuddy-cn` and `codebuddy-intl` executors.

- **Ported in this unit**: Both executors sanitize matching identity lines in system and developer text while preserving other lines and typed blocks; `tests/unit/port9r-5796-codebuddy-identity-lines.test.js` covers long rules, block metadata, and untouched user prompts.

---

### [#5787](https://github.com/decolua/9router/pull/5787) — fix(antigravity): fix Gemini 4 & Claude 5.5 model IDs and thinking mappings

- **Upstream source**: [9router PR #5787](https://github.com/decolua/9router/pull/5787)
- **Pinned head SHA**: `6ceccc1bf0a7074ac542e4119500a696b247d372`
- **State**: Open
- **Comparison with existing dispositions**:
  Reviewed in [1072-antigravity-thinking-models-5787.md](1072-antigravity-thinking-models-5787.md) at head `6ceccc1bf0a7074ac542e4119500a696b247d372`. The pinned head is unchanged.
- **Disposition**: **already in**
- **DurinDoor files/functions**:
  - [open-sse/providers/registry/antigravity.js](../../../open-sse/providers/registry/antigravity.js) (registration of Gemini 4 tiers, defaults, and aliases)
  - [open-sse/config/providerModels.js](../../../open-sse/config/providerModels.js) (`getModelUpstreamId` preserving `xhigh` and `max` tiers)
  - [open-sse/providers/thinkingLevels.js](../../../open-sse/providers/thinkingLevels.js) (`getThinkingLevels` declaring `low`, `medium`, `high`, `xhigh`)
  - [open-sse/translator/concerns/thinkingUnified.js](../../../open-sse/translator/concerns/thinkingUnified.js) (`toGeminiThinkingLevel` handling `xhigh` mapping and clamping)
  - Tested and guarded offline by [tests/unit/port9r-antigravity-thinking-models-5787.test.js](../../../tests/unit/port9r-antigravity-thinking-models-5787.test.js).

---

### [#5786](https://github.com/decolua/9router/pull/5786) — fix(custom-provider): publish the configured prefix, not the node id

- **Upstream source**: [9router PR #5786](https://github.com/decolua/9router/pull/5786)
- **Pinned head SHA**: `efbe45057816b197220135bcaf71cd1dc52c9523`
- **State**: Open
- **Comparison with existing dispositions**:
  Reviewed and ported in [1072-custom-provider-prefix-5786.md](1072-custom-provider-prefix-5786.md) at head `efbe45057816b197220135bcaf71cd1dc52c9523`. The pinned head is unchanged.
- **Disposition**: **already in**
- **DurinDoor files/functions**:
  - [src/shared/utils/providerPrefix.js](../../../src/shared/utils/providerPrefix.js) (`resolveProviderPrefix`, `isCustomProviderId`)
  - src/app/(dashboard)/dashboard/playground/playgroundHelpers.js (`normalizeStaticModel`, `normalizeLiveModel`, `resolveSavedModel`)
  - src/app/(dashboard)/dashboard/playground/PlaygroundPageClient.js (Playground display prefix vs canonical request model ID)
  - [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js) (request log line formatting)
  - [src/shared/components/ModelSelectModal.js](../../../src/shared/components/ModelSelectModal.js) (picker model prefix resolution)
  - [src/shared/hooks/useModelCaps.js](../../../src/shared/hooks/useModelCaps.js) (`buildDashboardCapsIndex` indexing prefix)
  - Tested and guarded offline by [tests/unit/port9r-custom-provider-prefix-5786.test.js](../../../tests/unit/port9r-custom-provider-prefix-5786.test.js).

---

### [#5780](https://github.com/decolua/9router/pull/5780) — feat(nvidia): support Kimi K3.1 Pro, Step 5 Preview and the live NIM catalogue

- **Upstream source**: [9router PR #5780](https://github.com/decolua/9router/pull/5780)
- **Pinned head SHA**: `3b2341aa6eb0236b2171959ce418e0ce7f3166e2`
- **State**: Open
- **Comparison with existing dispositions**:
  Reviewed in [1072-nvidia-existing-catalog-5780.md](1072-nvidia-existing-catalog-5780.md) at head `3b2341aa6eb0236b2171959ce418e0ce7f3166e2`. The pinned head is unchanged.
- **Disposition**: **already in**
- **DurinDoor files/functions**:
  - [open-sse/providers/registry/nvidia.js](../../../open-sse/providers/registry/nvidia.js) (registered chat NIM models `stepfun-ai/step-5-preview`, `minimaxai/minimax-m3.1-flash`, `z-ai/glm-5.3-flash`, `nvidia/nemotron-3.5-super-vl-120b-a12b`, `mistralai/mistral-large-4-1t-a52b`, while preserving default head `meta/llama-3.3-70b-instruct`)
  - [src/app/api/providers/[id]/models/modelsConfig.js](../../../src/app/api/providers/[id]/models/modelsConfig.js) (authenticated `/v1/models` discovery endpoint)
  - Tested and guarded offline by [tests/unit/port9r-nvidia-existing-catalog-5780.test.js](../../../tests/unit/port9r-nvidia-existing-catalog-5780.test.js). Upstream unauthenticated heuristic model fetcher and filter remain out of scope as documented.

---

### [#5679](https://github.com/decolua/9router/pull/5679) — feat(antigravity): add gemini-4-hydrogen model tiers and quota tracking

- **Upstream source**: [9router PR #5679](https://github.com/decolua/9router/pull/5679)
- **Pinned head SHA**: `db38def648cc6776592ef7da850cd1944198cdfd`
- **State**: Open
- **Comparison with existing dispositions**:
  Re-pinned at head `db38def648cc6776592ef7da850cd1944198cdfd`. Previously ported in DurinDoor via PR #2045 / commit `ee4d540e080` (referenced in [800-scan-reconciliation.md](800-scan-reconciliation.md)).
- **Disposition**: **already in**
- **DurinDoor files/functions**:
  - [open-sse/providers/registry/antigravity.js](../../../open-sse/providers/registry/antigravity.js) (registered `gemini-4-hydrogen-xhigh`, `gemini-4-hydrogen-high`, `gemini-4-hydrogen-medium`, `gemini-4-hydrogen-low`, and `gemini-4-hydrogen` base alias)
  - [open-sse/services/usage/google.js](../../../open-sse/services/usage/google.js) (`importantModels` for Antigravity quota polling)
  - Tested and guarded offline by [tests/unit/antigravity-gemini4-hydrogen-port.test.js](../../../tests/unit/antigravity-gemini4-hydrogen-port.test.js).

---

### [#4704](https://github.com/decolua/9router/pull/4704) — feat(combos): add intelligence-managed model selection

- **Upstream source**: [9router PR #4704](https://github.com/decolua/9router/pull/4704)
- **Pinned head SHA**: `939bc2fcfc5e4f62b73cf1f2e9af1d1e4295d5d5`
- **State**: Open
- **Comparison with existing dispositions**:
  Previously reviewed in [1072-composite-open-residuals.md](1072-composite-open-residuals.md) and [1072-combo-session-affinity-5316.md](1072-combo-session-affinity-5316.md) at head `9e442e7bbedfaab36b8075ea358bf4bd411b2a16`.
  *What changed since:* Head advanced from `9e442e7bbedfaab36b8075ea358bf4bd411b2a16` to `939bc2fcfc5e4f62b73cf1f2e9af1d1e4295d5d5` (commit `939bc2f`), resolving the review blocker noted in `1072-composite-open-residuals.md` regarding catalog discovery errors during combo refreshes: empty model lists are now only persisted after a successful catalog read proves that no configured route matches; discovery errors return HTTP 502 on manual refresh and are skipped without caching in scheduled refreshes.
- **Disposition**: **not applicable**
- **Analysis**:
  Components DurinDoor lacks. DurinDoor's combo router ([open-sse/services/combo.js](../../../open-sse/services/combo.js)) is behavior- and outcome-derived (smart-scoring using observed success/cooldown evidence, round-robin, and weighted rotation) rather than leaderboard-derived. DurinDoor explicitly does not ship the external score scraping infrastructure ([open-sse/services/freeProviderRankings.js](../../../open-sse/services/freeProviderRankings.js) documents that the `model_intelligence` table is not ported, and intelligence/elo fields are null by design). Introducing an unauthenticated external HTML scraper as a routing authority over local connections remains inapplicable to DurinDoor's architecture.

---

### [#5734](https://github.com/decolua/9router/pull/5734) — fix(providers): use live per-account model catalog for antigravity

- **Upstream source**: [9router PR #5734](https://github.com/decolua/9router/pull/5734)
- **Pinned head SHA**: `f8afea66f3a99bab81245154e6bc6c2d3acc8f96`
- **State**: Closed (unmerged)
- **Comparison with existing dispositions**:
  Closed unmerged upstream. Proposes querying live account-scoped models for Antigravity via `daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` with Hub fingerprint headers to avoid 404/403 errors and filter disabled models.
- **Disposition**: **already in**
- **DurinDoor files/functions**:
  - [open-sse/services/catalogs/antigravityCatalog.js](../../../open-sse/services/catalogs/antigravityCatalog.js) (`ANTIGRAVITY_CATALOG_URL`, `parseAntigravityCatalogModels`, `buildAntigravityCatalogBody`, `classifyAntigravityCatalogStatus`)
  - [src/app/api/providers/[id]/models/modelsConfig.js](../../../src/app/api/providers/[id]/models/modelsConfig.js) (configured with `ANTIGRAVITY_CATALOG_URL`, Hub/IDE headers, `buildBody`, `classifyStatus`, `parseResponse`)
  - [src/app/api/providers/[id]/models/fetchConnectionModels.js](../../../src/app/api/providers/[id]/models/fetchConnectionModels.js) (connection-scoped Antigravity project resolution, 403 backoff via `antigravityForbiddenBackoff` and `recordAntigravityForbidden`)
  - DurinDoor already has a more robust implementation that binds the request to the account's Cloud Code project and classifies status codes rather than sending an empty body.
