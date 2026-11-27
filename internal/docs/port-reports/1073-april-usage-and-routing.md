# #1073 — April 2026 OmniRoute usage and routing source changes

Reviewed 2026-11-21. This is a read-only documentation audit for [DurinDoor
#1073](https://github.com/bloodf/durindoor/issues/1073): six merged OmniRoute
pull requests from April 2026 are compared against the current local runtime and
the offline fixture evidence in this checkout. No runtime, configuration, or
product code was changed. This note makes no selection slate and names no owner.

## Scope, pins, and collection boundary

Six merged upstream pull requests, pinned to exact head and merge commits:

| Source PR | Head SHA | Merge SHA | UTC merged | Upstream subject |
| --- | --- | --- | --- | --- |
| [#932](https://github.com/cheaper-inference/OmniRoute/pull/932) | `b777b15ee897c72eced49564a113ebfac5bc4acc` | `83c358deb19e016c5a5cae1d930bfcc62e9b39ca` | 2026-04-02T23:46:38Z | feat(lkgp-strategy-919): last known good provider routing strategy |
| [#1049](https://github.com/cheaper-inference/OmniRoute/pull/1049) | `3bb905d7444c65bfe1070d25f0c54679f9c76f7d` | `51081de6bda1d63d204e91782e9c6a711d2a32ea` | 2026-04-08T02:25:17Z | fix: stop Codex limits refresh from downgrading healthy accounts |
| [#1208](https://github.com/cheaper-inference/OmniRoute/pull/1208) | `96ff1cd5131d9a6e4d28582f601969a40d7cbae5` | `625bcf105c75cae011c0ce452617ee4c3bdd3747` | 2026-04-13T16:10:17Z | fix: remove leading newline from omniModel tag injection |
| [#1331](https://github.com/cheaper-inference/OmniRoute/pull/1331) | `ce1a92cc15bd509ea5c2df4642ba6c5067e141c2` | `b1401812571008997cc45c53103c54b6b7e7985e` | 2026-04-16T14:52:28Z | fix: allow combo fallback on context overflow 400 errors |
| [#1333](https://github.com/cheaper-inference/OmniRoute/pull/1333) | `ea74a410fa65b02aafaaa43d52cbdaba2073e83c` | `4eedf4d1cd80edf7c5dc4275b4676e6a578218bf` | 2026-04-16T14:52:23Z | fix: preserve key_value settings across DB recreation |
| [#1338](https://github.com/cheaper-inference/OmniRoute/pull/1338) | `b54d23c12747b3cce4befb9ea009d0f335c53bac` | `68060d636d1e1f818a4203843a9bcc2524b68769` | 2026-04-16T15:53:37Z | feat: display Antigravity credit balance in dashboard Limits & Quotas |

Path lists come from `/var/tmp/durindoor-omni-early-metadata.gnjcuh68/2026-04.json`
(each row has a complete path list: `totalCount == nodes`, no next page). The six
rows were located by PR number; their path lists match the GitHub PR file list
for every row, so the metadata and the upstream file list agree.

### Exact merged source diff

The merged diff for each row was read from the upstream merge commit in a
read-only local checkout of `cheaper-inference/OmniRoute`, and cross-checked
against the public GitHub PR diff for the pinned head. One row needs a stated
caveat:

- **#1331** has an *empty* merge diff against its parent. Its merge commit
  `b1401812571008997cc45c53103c54b6b7e7985e` is a squash commit whose parent is
  `4eedf4d1cd80edf7c5dc4275b4676e6a578218bf` — the #1333 merge, which landed
  five seconds earlier (14:52:23 vs 14:52:28). #1333 already carried the
  identical `open-sse/services/accountFallback.ts` hunk, so #1331's merge commit
  changed no tree content. The #1331 merged source diff is therefore the same
  upstream hunk that #1333 merged, and both rows are assessed against that hunk
  once, with the #1333-only `src/lib/db/core.ts` hunk assessed separately.

### Comparison method

The upstream tree is TypeScript (`open-sse/services/usage.ts`,
`src/lib/db/core.ts`, …); this fork is the JavaScript lineage and **none of the
six upstream `*.ts` paths exist locally**. Path-level mapping is therefore not
available, and comparison was performed behavior-level:

1. upstream merged hunk read verbatim;
2. the local surface that owns that behavior located by whole-tree search;
3. local behavior read at the call site, not from names;
4. offline fixture evidence taken from `tests/` and run where it is runnable
   without credentials or network.

### Evidence limits

- Offline fixture runs used a temporary audit-only Vitest config
  (`tests/vitest.audit-1073.config.mjs`, deleted after the run) because this
  checkout has test dependencies but not root dependencies; the config mirrors
  the alias table of `tests/vitest.config.js` without the root `playwright`
  resolution. No repository config file was changed.
- No provider requests, no live upstream calls beyond reading public PR
  metadata and diffs, no browser, no Docker, no e2e, no full suite, no secret
  access, and no runtime change.
- Published disposition evidence reused rather than re-derived:
  [`1073-april-recovered-1-dispositions.md`](1073-april-recovered-1-dispositions.md)
  (these six rows previously recorded as `unresolved runtime`, and #1338 as
  `Provider Sign-in scope`), [`1073-first-quarter-row-dispositions.md`](1073-first-quarter-row-dispositions.md)
  (#614: no local `<omniModel>` sanitizer path), and
  [`1073-june1-row-dispositions.md`](1073-june1-row-dispositions.md)
  (#3248: upstream strips `<omniModel>` tags before forwarding to a provider).

## Dispositions

| Source PR | Disposition | Applicable local difference | Small isolated port still needed? |
| --- | --- | --- | --- |
| [#932](https://github.com/cheaper-inference/OmniRoute/pull/932) | **Excluded — new feature.** A new selectable combo routing strategy plus new persistence; no local counterpart to repair. | None that is a defect | **No** |
| [#1049](https://github.com/cheaper-inference/OmniRoute/pull/1049) | **Applicable local difference**, one narrow hunk. The other two upstream hunks have no local counterpart surface. | Yes — a Codex usage-endpoint 401 still drives the dashboard's auth-expired path | **Yes** — one branch in `open-sse/services/usage/codex.js` |
| [#1208](https://github.com/cheaper-inference/OmniRoute/pull/1208) | **Not applicable — no local counterpart surface.** The upstream tag protocol does not exist in this fork. | None | **No** |
| [#1331](https://github.com/cheaper-inference/OmniRoute/pull/1331) | **Local parity.** The upstream outcome is already implemented and covered offline. | None | **No** |
| [#1333](https://github.com/cheaper-inference/OmniRoute/pull/1333) | **Split.** Account-fallback hunk: local parity. DB-preservation hunk: no local counterpart scenario. | None | **No** |
| [#1338](https://github.com/cheaper-inference/OmniRoute/pull/1338) | **Excluded — new feature, provider-scoped.** Google One AI credits and credit-balance surfaces do not exist locally. | None | **No** |

## Row detail

### #932 — last known good provider routing strategy

**Merged source diff.** `open-sse/services/autoCombo/routerStrategy.ts` gains a
`lastKnownGoodProvider` field on `RoutingContext` and a new `LKGPStrategyImpl`
registered as `lkgp`; `open-sse/services/combo.ts` reads the pin before candidate
selection and writes it after a successful attempt; `src/lib/db/settings.ts` adds
`getLKGP`/`setLKGP` over a new `key_value` namespace `lkgp`; `src/lib/localDb.ts`
re-exports them.

**Local runtime.** No `lkgp` strategy, no persisted per-combo last-known-good
pin, and no `key_value` namespace exist locally. Local combo routing strategies
are `fallback`, `round-robin`, `weighted`, `smart-scoring`, and the task-routing
family (`open-sse/services/combo.js:669`, `open-sse/services/combo.js:1154`).
The nearest local construct, the `smart-scoring` success/failure score, is
process-local state only (`open-sse/services/combo.js:344`, a `Map` cleared with
the process) and is not a persisted pin, so it is not an equivalent of the
upstream feature. The upstream `lkgp` strategy was also revised further upstream
after April, so an April-era port would capture a partial form of a moving
feature.

**Disposition.** Excluded: this adds a new selectable routing strategy, a new
persisted namespace, and new `localDb` exports — new feature work, and not a
defect in existing behavior. **No small isolated port is needed.**

### #1049 — Codex limits refresh must not downgrade healthy accounts

**Merged source diff.** Three hunks:

1. `open-sse/services/usage.ts`: a Codex usage 401/403 returns
   `Codex usage details are unavailable for this account.` instead of
   `Codex token expired or access denied. Please re-authenticate the connection.`
2. `src/lib/tokenHealthCheck.ts`: when the access token is still valid, the
   periodic health check stops forcing a refresh, and a connection marked
   `expired` is returned to `active` ("access token still valid").
3. `src/lib/usage/providerLimits.ts`: Codex is exempted from
   `syncExpiredStatusIfNeeded` (a Codex usage fetch auth failure no longer marks
   the connection expired), and a Codex quota fallback is built from persisted
   quota snapshots when the live usage response has no quotas.

**Local runtime.**

- Codex usage endpoint: identical in both trees —
  `https://chatgpt.com/backend-api/wham/usage`
  (`open-sse/providers/registry/codex.js:55-56`, and upstream
  `CODEX_CONFIG.usageUrl`).
- Hunk 1 (message): the local non-OK branch returns
  `Codex connected. Usage API temporarily unavailable (${response.status}).`
  (`open-sse/services/usage/codex.js:252`). It carries no re-authentication
  instruction, so the *visible* message already avoids upstream's pre-#1049
  wording. **Difference:** the local message embeds the status code, and the
  dashboard usage route classifies any usage message containing `401` as
  auth-expired (`AUTH_EXPIRED_PATTERNS`,
  `src/app/api/usage/[connectionId]/route.js:19`) and then forces a credential
  refresh plus one retry (`src/app/api/usage/[connectionId]/route.js:147`). If
  that forced refresh fails, the route answers HTTP 401 `Credential refresh
  failed` — an auth-flavored failure for a Codex connection whose chat traffic
  may still work. Upstream after #1049 deliberately made the Codex usage
  auth-failure non-authoritative, so this local path is the one place where
  the two trees disagree.
- Hunk 2 (token health check): this fork has no periodic token-health refresh
  loop and no `tokenHealthCheck` counterpart. Credential refresh is on demand
  (`src/shared/services/providerCredentials.js:325` — refresh only when forced
  or when the executor asks for it), provider health probes are side-effect-free
  and write no connection status (`src/lib/healthMonitor.js`), and no local code
  path writes `testStatus: "expired"`. The upstream failure mode — an elapsed
  interval forcing a refresh that then produced a false "re-authenticate" — has
  no local equivalent.
- Hunk 3 (expired-status sync): correspondingly absent locally; a Codex usage
  fetch can never mark a local connection expired. The snapshot-fallback outcome
  is present in a broader local form: dispatch-time quota decisions read
  persisted snapshots including stale ones
  (`src/shared/services/providerQuotaPreflight.js:488`), and the dashboard quota
  card falls back to the cached rows with a stale reason when the live fetch
  returns no quota rows
  (`src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js:359`).

**Expected existing behavior.** Today a Codex usage-endpoint rejection produces a
usage message only: no connection status change, no cooldown, no account lock,
and the dashboard renders cached quota rows marked stale when live rows are
missing. The only divergence from upstream is that the usage card triggers one
forced credential refresh and one retry when the message reads as auth-expired,
and surfaces a 401 if that refresh fails.

**Disposition.** Applicable local difference, confined to hunk 1: the Codex
usage 401/403 branch still classifies as an auth failure locally. A small
isolated port is warranted — one branch in `open-sse/services/usage/codex.js`
returning a message without auth-flavoured tokens for 401/403, which stops the
dashboard's auth-expired classification without touching the chat-path refresh,
the local `requestScoped` account policy, or any provider registry. It needs one
focused offline test; it must not reintroduce any status write from the usage
path, because local already satisfies upstream hunk 3 by construction.

### #1208 — remove the leading newline from omniModel tag injection

**Merged source diff.** `open-sse/services/combo.ts` and
`open-sse/services/comboAgentMiddleware.ts` drop the leading `\n` from the
injected `<omniModel>…</omniModel>` assistant tag, in the streaming path and in
both non-streaming message paths.

**Local runtime.** This fork has no `<omniModel>` surface at all: a whole-tree
search finds the token only inside these internal port reports, never in
`open-sse/` or `src/`. The local client-visible model-identity mechanism is a
different one — a Responses lifecycle-frame rewrite of `response.model`
(`open-sse/services/responseModelEcho.js`) — which rewrites complete SSE frames
and therefore has no equivalent of the upstream defect (content appended after
`finish_reason`, where SDKs drop what arrives after the marker). The upstream
problem statement (an SDK closing the connection at `finish_reason`, so trailing
tag content is silently lost) has no local reproduction surface.

**Disposition.** Not applicable: the upstream tag protocol does not exist in this
fork, so there is no local difference to repair and **no small isolated port is
needed**. This reuses the published #614 and #3248 findings rather than
re-deriving them.

### #1331 — combo fallback on context-overflow 400 errors

**Merged source diff.** `open-sse/services/accountFallback.ts` adds
`CONTEXT_OVERFLOW_PATTERNS` and `MALFORMED_REQUEST_PATTERNS`; a 400 matching
either now returns `shouldFallback: true` with `cooldownMs: 0` and reason
`MODEL_CAPACITY`, instead of never falling back.

**Local runtime.** Local implements the same outcome through a broader rule.
`checkFallbackError` treats a request-scoped client error — context overflow,
malformed body, unsupported parameter — as `shouldFallback: false`,
`cooldownMs: 0`, `requestScoped: true`
(`open-sse/services/accountFallback.js:312`), and combo rotation uses that flag
to advance to the next member without cooldown, waiting, or a smart-scoring
penalty (`open-sse/services/combo.js:1810`). A 400 `invalid_request_error` is
likewise request-scoped (`open-sse/services/accountFallback.js:96`).

**Difference in shape, not in outcome.** Upstream rotates the *account* as well
(the same model on another credential), because upstream treats a 400 overflow as
a credential-rotation-eligible condition. Local does not: it treats the 400 as
request-scoped and rotates the *combo member* only, deliberately, since a
request-scoped rejection says nothing about the credential
(`open-sse/services/accountFallback.js:300-311`). Local per-model fallback keeps
the matching upstream assumption that a context-length 400 will not be fixed by
retrying the same model (`open-sse/services/modelFallback.js:13`,
`isDeterministicPayloadError`). The user-visible outcome of the upstream row —
a context-overflow 400 does not end the request but lets another combo member
serve it — is already the local behavior.

**Offline fixture evidence.** `tests/unit/account-fallback-request-scoped-4xx.test.js`
covers a 400 "maximum context length" and a 400 "prompt is too long"
`invalid_request_error` as request-scoped without account cooldown, and
`tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js` covers the combo
advancing past a request-scoped 400 to the next member. Both files were run
offline in this checkout: **2 files, 22 tests, all passing**.

**Disposition.** Local parity; **no small isolated port is needed**. The
account-rotation difference is local policy, recorded here so it is not
re-discovered as a gap.

### #1333 — preserve key_value settings across DB recreation

**Merged source diff.** Two hunks: the `open-sse/services/accountFallback.ts`
hunk is byte-identical to #1331's, and `src/lib/db/core.ts` reads the whole
`key_value` table before any potential DB file rename or recreation, skips the
`syncedAvailableModels`, `providerLimitsCache` and `lkgp` namespaces, and
restores the remaining rows with `INSERT OR IGNORE` after the DB is (re)created.

**Local runtime.**

- Account-fallback hunk: identical to #1331 — local parity, covered by the same
  offline fixtures.
- DB-preservation hunk: this fork has no counterpart scenario. Local opens or
  creates the SQLite file in place and applies ordered migrations
  (`src/lib/db/driver.js`, `src/lib/db/index.js:988`); there is no
  "probe schema → rename or delete the file → recreate from scratch" path, so
  the upstream failure mode (a schema-mismatch or probe failure wiping the
  database) cannot occur here. Local's equivalent protections are
  pre-upgrade backups and an additive migration chain
  (`src/lib/db/migrate.js:381`, `src/lib/db/migrate.js:418`). Local's
  key/value storage is a scope-based `kv(scope, key, value)` table
  (`src/lib/db/helpers/kvStore.js`), not a `key_value` namespace table, so the
  upstream namespace skip-list has no local mapping and no upstream row is at
  risk.

**Disposition.** Split: the account-fallback hunk is local parity; the
DB-preservation hunk has no local counterpart scenario. **No small isolated
port is needed** for either part.

### #1338 — Antigravity credit balance in Limits & Quotas

**Merged source diff.** `open-sse/executors/antigravity.ts` gains a credits mode
(`shouldUseCreditsFirst`/`getCreditsMode`), a pass-through `TransformStream`
that extracts `remainingCredits` from the final SSE chunk without consuming the
stream, DB persistence of the per-account balance, and a switch of the cache key
from the account email to `connectionId`; `open-sse/services/usage.ts` adds a
proactive credit-balance probe (a minimal `streamGenerateContent` request with
`enabledCreditTypes: ["GOOGLE_ONE_AI"]`) and a `credits` quota row;
`src/lib/db/creditBalance.ts` is a new file; `src/lib/localDb.ts` and
`src/lib/usage/fetcher.ts` follow the account-key change.

**Local runtime.** None of this surface exists locally: a whole-tree search
finds no `GOOGLE_ONE_AI`, no `remainingCredits`, no `enabledCreditTypes`, and no
credits service for Antigravity, and there is no credit-balance table or
dashboard row. The local Antigravity executor does parse quota-exhaustion
signals and reset delays (`open-sse/executors/antigravity.js:800`), which is a
different mechanism from Google One AI credit balance.

**Disposition.** Excluded: this is new feature work — a new credit subsystem, a
new persisted table, a proactive upstream probe, and a new dashboard row — and it
is provider-scoped work on the Antigravity Google One AI credits contract, which
the April ledger already recorded as Provider Sign-in scope
([`1073-april-recovered-1-dispositions.md`](1073-april-recovered-1-dispositions.md)).
**No small isolated port is needed**, and nothing here is claimed as a defect in
existing local behavior.

## Scope boundaries applied

- **Provider Sign-in:** new provider identities and authentication/sign-in work
  are left to that workstream. This affects #1338, whose credit-balance contract
  depends on Antigravity account credits and the account-key change.
- **New features and integrations** are excluded from this comparison. This
  affects #932 (new routing strategy and persistence) and #1338 (new credit
  subsystem, table, and dashboard row).
- **No owner selection list** is produced: this note records dispositions and
  evidence only.
- Unrelated April rows, and the remaining rows of
  [`1073-april-recovered-1-dispositions.md`](1073-april-recovered-1-dispositions.md),
  keep their recorded status; nothing outside these six rows is reclassified
  here.

## Verification performed in this checkout

| Check | Result |
| --- | --- |
| `tests/unit/account-fallback-request-scoped-4xx.test.js` + `tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js` (offline, focused) | 2 files, **22 tests passed** |
| `tests/unit/codex-usage-credential-binding.test.js` + `tests/unit/codex-usage-fetch-timeout.test.js` (offline, focused) | 2 files, **3 tests passed** |
| Whole-tree search for `omniModel`, `lkgp`, `lastKnownGoodProvider`, `GOOGLE_ONE_AI`, `remainingCredits`, `key_value` | no local runtime occurrence (only report prose; `lastKnownGood` occurs in `open-sse/services/catalogs/ollamaCatalog.js` as an unrelated in-memory model-catalog cache) |
| Whole-tree search for local writes of `testStatus: "expired"` | none — no local path marks a connection expired from a usage fetch or a health interval |
| Upstream diff cross-check | merge-commit diffs read for #932, #1049, #1208, #1333, #1338; #1331's merge commit is an empty squash and the PR diff is authoritative (identical to #1333's `accountFallback.ts` hunk) |
| Metadata path-list cross-check | all six rows match the upstream PR file lists exactly |
