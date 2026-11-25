# #1072 — 9router #5575 "Usage by Combo" vs the current DurinDoor combo attribution

Disposition: **partially adapted — most of the 21-path patch is inapplicable (System One Smart
Router) or already present in a stronger fork-native form; one confirmed residual remains and is
specified below with an offline acceptance test.** No product code, test, baseline, CI or
`AGENTS.md` change is part of this row; this file is the only artifact.

Scope inputs: the earlier #1072 combo/history preliminary row
([1072-combo-history-residuals.md](1072-combo-history-residuals.md)), the refreshed #800 scan
reconciliation ([800-scan-reconciliation.md](800-scan-reconciliation.md)), and the merged
DurinDoor #2072 per-combo prompt work recorded in
[1072-combo-configured-system-prompts.md](1072-combo-configured-system-prompts.md).

## Source pin and traceability

| Field | Value |
| --- | --- |
| Source PR | [9router #5575](https://github.com/decolua/9router/pull/5575) — "feat(usage): add Usage by Combo view with router statistics" |
| Inspected open head | `341c8dc267452f373debfa623e1e0bf8dd054e92` |
| Head re-verified at | 2026-11-21 — **unchanged**; `gh pr view 5575 --repo decolua/9router` reports `headRefOid: 341c8dc267452f373debfa623e1e0bf8dd054e92`, state `OPEN`, `MERGEABLE` |
| Exact diff base | upstream `master` merge-base `1339107e624d1ab150c6a0c2c2ee22caa7e9db2f` (v0.5.116) |
| Patch read from | `git fetch upstream refs/pull/5575/head:refs/remotes/upstream/pr-5575`, then `git diff 1339107e6..341c8dc2` — 21 paths, 740 insertions, 34 deletions |
| Parent commit in the same PR | `c33e53c2196df817238c6950e06b2cc254c93ad7` (the #5574 payload, carried inside the #5575 diff) |

The inspected pin and the current head are the same commit, so **there is no new pin to record and
no superseded pin to retain**: `341c8dc267452f373debfa623e1e0bf8dd054e92` is both the pin this row
was written against and the pin that is live upstream today. The earlier #1072 preliminary row and
the #800 reconciliation both cite the same `341c8dc…` head, so the two prior records remain
consistent with this report.

The 21-path diff is the union of two upstream commits, and that union matters for the split below:

- `c33e53c2` (13 paths) — Smart Router routing rules + per-combo system prompt (the #5574 payload).
- `341c8dc2` (11 paths) — Usage by Combo + router statistics (the #5575 payload).

## The exact 21-path patch, split three ways

### Group A — combo admission / routing policy / UI (11 paths)

| Path | Upstream change | Disposition |
| --- | --- | --- |
| `open-sse/services/systemoneRouter.js` (+33/-5) | `buildChoiceCriteria(models, descriptions)` accepts per-member "when to pick" text; `resolveRouteInstructions()` overrides the System One question | **Inapplicable.** The fork has no `systemoneRouter` module and no System One decision path (grep for `resolveSmartChoice`, `buildChoiceCriteria`, `resolveRouteInstructions` returns nothing). |
| `src/sse/services/systemoneRouter.js` (+9/-2) | Threads `routerInstructions` / `memberDescriptions` into the router call | **Inapplicable** (same reason). |
| `open-sse/services/combo.js` (+17) | `handleComboChat` gains an optional `onRouteAttempt` callback and tracks `routeOutcome` / `routeConfidence` | **Inapplicable as an outcome source.** The fork's `handleComboChat` has no router decision to report; the fork's `smart` strategy is local complexity classification, not upstream's Smart Router (see below). |
| `open-sse/handlers/chatCore.js` (+7/-1) | `handleChatCore` accepts `comboPrompt` and injects it at the translated system boundary | **Already present** in the #2072 form (fork injects the inherited `comboPrompts` list at the same boundary). |
| `open-sse/rtk/customPrompt.js` (+18) | `resolveComboPrompt(...)` + `MAX_COMBO_PROMPT_CHARS` (8000) | **Already present, fork-native.** The fork's `appendComboPrompt` (`open-sse/rtk/comboPrompt.js:5`) returns an inherited outer-to-inner list, consults only the protected `comboPrompts` map, and caps the value at the settings boundary. |
| `src/sse/handlers/chat.js` (+44/-9 total; +20/-7 here) | Per-combo prompt plumbing into members and nested combos; new `routerInstructions` / `memberDescriptions` arguments | Prompt plumbing **already present** (`src/sse/handlers/chat.js:588`, `:810`, `:1330`); the two router arguments are **inapplicable**. |
| `src/app/(dashboard)/dashboard/combos/page.js` (+36/-4) | Per-combo **Prompt** button on each combo card; routing-rules props into the policy modal | Prompt button: **divergence** (no fork dashboard editor; the same value is writable through `PATCH /api/settings` → `comboPrompts`, `src/app/api/settings/route.js:325`). Routing-rules props: **inapplicable**. |
| `src/shared/components/ComboPromptModal.js` (+62, new) | Editor modal for the per-combo prompt | **Divergence**, same reason as the Prompt button. |
| `src/shared/components/SmartPolicyModal.js` (+73/-1) | "Routing rules" section (router instructions + per-member descriptions) | **Inapplicable.** The fork has no `SmartPolicyModal` and no `smartPolicy` / `confidenceThreshold` / `routerModel` settings at all. |
| `src/shared/components/index.js` (+1) | Exports `ComboPromptModal` | **Inapplicable** with the modal. |
| `gitbook/content/en/features/combos.md` (+9) | Documents System One routing rules, per-combo prompt and Usage per Combo | **Not ported as text** — the fork's docs live in `docs/features/combos.mdx` and already describe the fork's Connection usage report (`docs/features/combos.mdx:15`). |

### Group B — usage attribution (3 paths)

| Path | Upstream change | Disposition |
| --- | --- | --- |
| `src/sse/handlers/chat.js` (+37/-11) | Tags each request with the combo it came through (`combo`) and the inner combo for nested combos (`comboVia`); carries the route outcome | **Already present in a stronger form** — the fork resolves the combo's routing policy once per request and passes the persisted combo identity (`comboRouting.id` / `.name`) into `handleChatCore` (`src/sse/handlers/chat.js:585`, `:1309-1310`). Nested combos deliberately keep the **outer** combo as the owner (`src/sse/handlers/chat.js:802-803`), so upstream's `comboVia` field is not adopted. |
| `src/lib/db/repos/usageRepo.js` (+80/-5) | New `byCombo` bucket in the daily rollup; combo/route/failover metadata written into `usageHistory.meta`; `byCombo` added to both read paths of `getUsageStats` | **Mostly already present, storage and rollup shapes not adopted.** See the comparison below. |
| `src/shared/components/UsageStats.js` (+79) | New "Usage by Combo" table view: combo group rows, the models that served them, each model's share, and router statistics on the combo row | **Partially present.** The fork has a combo usage report on **Dashboard → Combos** (`ComboUsageReport`), not in the Usage table; the report groups by combo + connection and has **no per-model breakdown and no share**. This is the confirmed residual. |

### Group C — response processing (4 paths + 1 test)

| Path | Upstream change | Disposition |
| --- | --- | --- |
| `open-sse/handlers/chatCore/requestDetail.js` (+10/-2) | `saveUsageStats` gains `combo`, `comboVia`, `comboRoute` and derives `route` / `routeConfidence` / `failover` | **Already present in a stronger form.** The fork's `saveUsageStats` (`open-sse/handlers/chatCore/requestDetail.js:150`) already carries `comboId` / `comboName` plus `apiKeyId`, `billingEpoch`, `usageEventId`, `latency` and `status` — all of which upstream's version lacks. |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` (+2/-1) | Passes the combo fields into `saveUsageStats` | **Already present** (`open-sse/handlers/chatCore/nonStreamingHandler.js:515`, `:670`). |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` (+4/-2) | Same, on both forced-SSE→JSON branches | **Already present** (`open-sse/handlers/chatCore/sseToJsonHandler.js:424`, `:477`, `:641`). |
| `open-sse/handlers/chatCore/streamingHandler.js` (+2/-1) | Same, on stream completion and stream cancellation | **Already present** (`open-sse/handlers/chatCore/streamingHandler.js:111`, `:278`, `:347`, `:410`). |
| `tests/unit/usage-by-combo.test.js` (+91, new) | Upstream's read-path and router-counter assertions | Upstream-only shape; the fork's equivalent coverage is `tests/unit/combo-connection-usage-attribution.test.js`. |

## Usage attribution vs the current local implementation

**Local storage is stronger than upstream's, and upstream's storage shape must not be copied.**

Upstream stores combo identity as JSON inside the existing `usageHistory.meta` column
(`stringifyJson(entry.combo ? { combo, comboVia, route, routeConfidence, failover } : {})`) and
adds a parallel `byCombo` bucket to the daily rollup blob. The fork instead:

- persists the combo identity in **dedicated, indexed columns** `usageHistory.comboId` /
  `usageHistory.comboName` (`src/lib/db/schema.js:280-284`, partial index
  `idx_uh_combo` at `src/lib/db/schema.js:291`), added by migration
  `src/lib/db/migrations/017-connection-groups.js:39-44`;
- writes those columns through the normal usage write path
  (`src/lib/db/repos/usageRepo.js:961-970`), so they land on the same row as the request's
  receipt, pricing and status data;
- deliberately leaves historic rows and direct requests `NULL` and never backfills or infers them
  (migration comment `017-connection-groups.js:13-16`; `src/app/api/usage/combos/route.js:9`).

Adopting upstream's `meta` write verbatim would be a regression on three contracts at once:

1. **Normalized accounting / receipt ledger.** The fork's `entry.meta` is authoritative and
   carries `costStatus`, `costSource`, `pricing`, `completedAt`, `modality` and `nativeUnits`
   (`src/lib/db/repos/usageRepo.js:870-874`, `:732`). Upstream's expression replaces `meta`
   wholesale with combo fields, so a port would drop the pricing evidence on every combo request.
2. **Receipt / settlement.** The fork writes usage through the receipted path — accepted-row
   settlement (`src/lib/db/repos/usageRepo.js:729-739`), the `usageEventReceipts` idempotency
   ledger (`src/lib/db/repos/usageRepo.js:678-692`) and the API-key policy totals
   (`src/lib/db/repos/usageRepo.js:1000`). Upstream's `saveRequestUsage` has none of these, so
   copying its insert shape would bypass them.
3. **Quota and routing policy.** The fork's combo dispatch resolves the routing policy once
   (`src/sse/handlers/chat.js:585`), ranks members under it (`rankComboModelsByQuota`,
   `src/sse/handlers/chat.js:665`), and reserves quota per attempt. Upstream's patch adds an
   outcome callback without touching that machinery; the fork has no equivalent callback and must
   not gain one that reorders or re-selects members.

**The upstream `byCombo` daily-rollup bucket is not needed.** The fork's combo report reads
`usageHistory` directly (`src/app/api/usage/combos/route.js:59-69`), so there is no second store
to keep consistent. Upstream's shape requires merging the rollup with a history overlay
(`src/lib/db/repos/usageRepo.js` upstream diff, the `day.byCombo` loop plus the `meta` overlay
pass), which is a double-source merge; the fork avoids it. Retention also treats both stores
alike — `pruneUsageBeforeInTx` deletes history and daily rows together
(`src/lib/db/repos/usageRepo.js:2032-2044`) — so a rollup bucket would add duplication without
extending the window.

**What the fork already answers that upstream adds.** Both attribute a request to the combo that
served it, keep pre-attribution history unattributed, and expose an "unattributed" bucket. The
fork's bucket is explicit (`src/app/api/usage/combos/route.js:70-78`,
`ComboUsageReport.jsx:108-112`) and covered offline by
`tests/unit/combo-connection-usage-attribution.test.js:99-132`, which drives the real
`handleChatCore` for a non-streaming and a streaming request and asserts the row identity,
the report rows and the unattributed totals. The fork also tags media combo routes
(`tests/unit/media-query-usage.test.js:180-182`), which upstream explicitly leaves as "Direct".

## Response processing vs the current local implementation

Upstream's response slice is three one-line changes plus one signature change: attach the combo
metadata to the `saveUsageStats` call in the non-streaming, forced-SSE→JSON and streaming
handlers. The fork already does this on all three paths with a richer payload, so there is no
residual in this group.

Two fork contracts sit on these paths and must remain untouched by any later port of this row:

- **Non-streaming tools and reasoning.** The fork's non-streaming handler decloaks tool names
  before translation, normalizes inline `<think>` reasoning, restores client-facing tool aliases
  for OpenAI / Gemini / Claude clients, and only then extracts usage and persists it
  (`open-sse/handlers/chatCore/nonStreamingHandler.js:633-670`). Adding metadata to the
  `saveUsageStats` call must not move that ordering, and the usage normalization
  (`extractUsageFromResponse`, plus the OpenAI-shaped normalization in `saveUsageStats`) must keep
  producing the same token counts.
- **Forced SSE → JSON.** Both branches persist usage after their own cache-inclusive
  normalization (`open-sse/handlers/chatCore/sseToJsonHandler.js:477`, `:641`); combo metadata
  rides on the same call and must not change the recorded totals or the error-finish semantics.

The fork's streaming path additionally records a cancelled partial usage row
(`open-sse/handlers/chatCore/streamingHandler.js:410`) that upstream has no equivalent for;
attribution must reach that row too, which it already does.

## System One `byCombo` counters vs fixes usable on existing local data

This is the distinction the row turns on.

**Upstream's router counters are a new System One surface, not a fix on existing data.**
`routed`, `kept`, `defaulted`, `confidenceSum` and `confidenceCount` are produced only by
upstream's Smart Router decision path:

- `routed` / `kept` / `default` are set from upstream's `smart` strategy outcomes
  (router decision used, session model kept, configured order used because the router was unsure
  or unavailable), and `routeConfidence` exists only where the router returns a confidence value.
- The fork has no router decision to count. Its `smart` strategy is a local, deterministic
  complexity classification — `classifyTask` returns `light` / `standard` / `heavy` / `critical`
  from local signals only (`open-sse/services/combo.js:851-901`), reordering members by task
  weight (`open-sse/services/combo.js:1557-1574`). It has no confidence value, no session
  keep-or-switch decision, no router model and no router question.
- The fork therefore has no `resolveSmartChoice`, no `buildChoiceCriteria` and no
  `resolveRouteInstructions` anywhere in the tree, and no `smartPolicy` /
  `confidenceThreshold` / `routerModel` settings. Importing the counters would record a column of
  structural zeros or invent a confidence the fork never computes.

**Upstream's `failover` counter is strategy-agnostic but not derivable from existing local rows.**
Upstream derives it from the member index inside its own combo loop (`attempt > 0`). The fork
counts attempts internally and can report the number (`withRouteResponseHeaders(... attempts: i + 1)`,
`open-sse/services/combo.js:1751`, and only when `jevClassify` is on), but it does not persist
that number, and the fork's nested / fusion dispatch has a different attempt structure from
upstream's flat loop. Persisting a failover count would therefore need new stored data (a column
or a meta field), which is a schema and receipt-contract decision, not a port of this row.

**What is genuinely independently useful on existing local data** is the *grouping* upstream
introduces, not its counters: upstream keys its combo aggregate by
`combo | comboVia | model | provider` and shows each model's share of that combo's requests. The
fork's rows already carry everything that key needs — `comboId`, `comboName`, `model` and
`provider` are all stored on `usageHistory` — but the fork's report groups by
`comboId, comboName, connectionId` (`src/app/api/usage/combos/route.js:60-68`) and renders
"Connection" rather than "Model served" (`ComboUsageReport.jsx:11-18`). That is the one
confirmed residual of this row.

## Confirmed residual: per-model breakdown and share in the combo usage report

**Residual.** The combo usage report groups requests by combo and connection. It does not show
which model inside the combo served the request, nor that model's share of the combo's requests.
When two members of one combo are served through the same connection, the current rows cannot
distinguish them. Upstream's view answers this directly.

**Why it is a residual and not a divergence.** The data is already there: every combo-attributed
row carries `comboId`, `comboName`, `model` and `provider`. The fix is a read-path change only —
no schema change, no new column, no write-path change, no new rollup bucket, no request-path
change. It therefore applies to rows that are already recorded.

**Why upstream's implementation is not copied.** Upstream's `byCombo` bucket requires the
`meta`-JSON storage shape, the rollup-plus-overlay merge, and the System One counters, none of
which the fork wants. The fork's equivalent is a `GROUP BY` extension on the existing query plus
a share computed from the same rows.

**Scope of the fix (for the follow-up work order).**

- `src/app/api/usage/combos/route.js` — group by combo and served model/provider as well as
  connection, and return each model's request count plus its share of the combo's requests.
- `src/app/(dashboard)/dashboard/combos/components/ComboUsageReport.jsx` — render "Model served"
  and the share, keeping the existing "Connection" column and the existing "Not attributed to a
  combo" footer.
- No changes to `src/lib/db/repos/usageRepo.js`, `src/lib/db/schema.js`, `open-sse/handlers/**`,
  or any request-path module.

### Offline acceptance test

Add `tests/unit/combo-model-usage-attribution.test.js` (tests are out of scope for this row; the
spec is recorded here). It must be offline, must not touch a provider, and must run with:

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/combo-model-usage-attribution.test.js --maxWorkers=2
```

Fixtures and assertions:

1. **Per-model grouping inside one combo.** Seed `usageHistory` rows directly (no transport): two
   rows for combo `combo-1` / `Production` served by model `small`, one row for the same combo
   served by model `large`, and one direct row with `comboId`/`comboName` `NULL`. Assert the report
   returns one entry per `(combo, model)` with requests `2` and `1`, and a share of `67`% and `33`%
   of the combo's three requests.
2. **No double counting.** Assert the sum of the combo's per-model requests equals the combo's
   total, and that the report's attributed requests plus the unattributed bucket equal the number
   of seeded rows.
3. **Future-only boundary preserved.** Seed one row with `comboId`/`comboName` `NULL` and a
   timestamp before the attribution boundary. Assert it stays in the unattributed bucket and is
   never re-attributed by matching a combo name.
4. **Normalized accounting untouched.** Assert the per-model request/token/cost totals equal the
   `SUM` of the seeded rows for that model, and that the report performs no write: the
   `usageHistory` row count, the `usageDaily` blobs and the `totalRequestsLifetime` counter are
   identical before and after the read.
5. **Receipt contract preserved.** Assert the seeded rows keep their `usageEventId` and that
   re-inserting the same `usageEventId` does not create a second history row (the
   `usageEventReceipts` ledger stays idempotent), and that reading the report emits no new
   receipt keys.
6. **Quota and routing policy untouched.** Assert the API-key policy totals are unchanged by the
   read, and that a combo request executed immediately before and after the report read selects
   the same member under the same routing policy — the report is read-only and must not move the
   round-robin pointer, the sticky rotation or the quota reservation.

Assertion 4 and 5 are the guards that keep the fix inside the read path; a change to the write
path, the receipt ledger or the usage schema fails them.

### Contracts that must not change

| Contract | Where it lives | Why the residual must not touch it |
| --- | --- | --- |
| Usage receipt / idempotency | `src/lib/db/repos/usageRepo.js:678-692`, `:1006` | One accepted row per usage event; no duplicate rows on retry. |
| Accepted → settled row lifecycle | `src/lib/db/repos/usageRepo.js:729-739` | The row keeps its creation timestamp and settles in place. |
| Normalized accounting / pricing evidence | `src/lib/db/repos/usageRepo.js:870-874`, `src/lib/db/repos/usageRepo.js:216` | `meta` carries `costStatus`, `costSource`, `pricing`, `modality`, `nativeUnits`; upstream's `meta` write would erase them. |
| Unknown-cost accounting | `src/lib/db/repos/usageRepo.js:214`, `src/lib/db/repos/usageRepo.js:868` | Unknown-cost request counts must not change with a new grouping. |
| API-key quota / policy totals | `src/lib/db/repos/usageRepo.js:998-1006` | MCP errors stay exempt; failed requests keep their attribution rules. |
| Combo routing policy and admission | `src/sse/handlers/chat.js:585`, `:495-501`, `open-sse/services/comboRoutingPolicy.js` | Combo ACL and per-combo allow-lists are unchanged; the report is an observation, not a routing input. |
| Outer-combo attribution | `src/sse/handlers/chat.js:802-803` | Nested combos narrow eligibility but never replace the outer combo as the attribution owner. |
| Per-combo prompt contract (#2072) | `open-sse/rtk/comboPrompt.js:5`, `open-sse/handlers/chatCore.js:1025-1032` | `comboPrompts` is the only consulted source; legacy strategy fields stay inert; the injection point and outer-to-inner order are unchanged. |
| Future-only attribution boundary | `src/lib/db/migrations/017-connection-groups.js:13-16` | Historic rows are never backfilled or inferred. |

## Incidental finding (not a port)

The operator-facing boundary string in the combo report names the wrong migration:
`src/app/api/usage/combos/route.js:9` says attribution "starts with migration 014", but
`usageHistory.comboId` / `comboName` are added by `017-connection-groups.js`. The message is
text only and changes no data; it should be corrected in a follow-up that touches that route
(anyway, for the residual above), not in this documentation-only row.

## Offline evidence

All checks were run offline against the local checkout and the fetched upstream refs; no provider
traffic, no API spend, no browser, no Docker, no e2e run.

1. Upstream head and state:
   `gh pr view 5575 --repo decolua/9router --json headRefOid,state,files,commits` →
   head `341c8dc267452f373debfa623e1e0bf8dd054e92`, state `OPEN`, 21 files.
2. Exact patch read locally:
   `git fetch --no-tags upstream 'refs/pull/5575/head:refs/remotes/upstream/pr-5575'` →
   `git diff --stat 1339107e624d1ab150c6a0c2c2ee22caa7e9db2f refs/remotes/upstream/pr-5575` →
   21 paths, 740 insertions, 34 deletions; the two per-commit splits (`c33e53c2`, `341c8dc2`)
   were read with `git show`.
3. Local implementation comparison, read-only:
   `grep` over `src/` and `open-sse/` for `comboId|comboName|comboVia|byCombo|onRouteAttempt|comboRoute|resolveComboPrompt|resolveSmartChoice|buildChoiceCriteria|resolveRouteInstructions`
   → the fork has `comboId`/`comboName` in `requestDetail.js`, `nonStreamingHandler.js`,
   `sseToJsonHandler.js`, `streamingHandler.js`, `chatCore.js`, `usageRepo.js`, `chat.js`,
   `combo.js` and the schema; it has **no** `byCombo`, `onRouteAttempt`, `comboRoute`,
   `resolveSmartChoice`, `buildChoiceCriteria` or `resolveRouteInstructions` anywhere.
4. Existing local coverage confirmed by reading
   `tests/unit/combo-connection-usage-attribution.test.js` (real `handleChatCore`, non-streaming
   and streaming, row identity, report rows, unattributed totals).
5. Report artifact check:
   `test -s internal/docs/port-reports/1072-combo-usage-metadata-5575.md && rg -q -F 341c8dc267452f373debfa623e1e0bf8dd054e92 internal/docs/port-reports/1072-combo-usage-metadata-5575.md`.

## Disposition and follow-ups

| Item | Disposition |
| --- | --- |
| 9router #5575 at `341c8dc267452f373debfa623e1e0bf8dd054e92` | **Partially adapted.** System One routing rules and router counters: not applicable. Per-combo system prompt: already present (#2072). Combo usage attribution and its response-path propagation: already present, in a stronger fork-native form. Usage by Combo view: present on Dashboard → Combos; **one confirmed residual** (per-model breakdown and share), specified above. |
| Residual — per-model breakdown and share | **Open**, with a read-path-only offline acceptance test. Needs its own work order; this row changes no product code. |
| Upstream `byCombo` daily-rollup bucket and `meta`-JSON combo storage | **Not adopted**, deliberately: they would duplicate the fork's indexed `comboId`/`comboName` columns, clobber the fork's `meta` accounting payload and bypass the receipt, settlement and quota paths. |
| Upstream `failover` counter | **Deferred.** Strategy-agnostic in upstream, but not derivable from the fork's stored rows; persisting it needs new stored data and a receipt/contract decision. |
| Nested-combo `comboVia` hop | **Deliberate divergence.** The fork keeps the outer combo as the attribution owner so usage reporting stays honest (`src/sse/handlers/chat.js:802-803`). |
| Per-combo prompt dashboard editor | **Divergence.** The value is writable through `PATCH /api/settings` (`comboPrompts`); the fork has no per-card Prompt button or modal. |
| Boundary message naming migration 014 | **Minor text fix** for the follow-up that touches `src/app/api/usage/combos/route.js`. |
| Upstream PR state | Still `OPEN` upstream at the same head; no upstream change was made, proposed or reviewed from this row. |

No upstream issue, pull request, comment or push was created or changed; the only commit for this
row is a local documentation commit.
