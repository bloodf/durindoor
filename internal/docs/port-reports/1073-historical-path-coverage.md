# #1073 — historical OmniRoute source-path coverage

Reviewed 2026-11-20 against DurinDoor `936cb835b` (branch `orq/tornf6/audit-omni-merged-path-coverage-a1-l2`), with `main` at `ba573d0e7`.

Scope: turn the historical merged OmniRoute records in [#1073](https://github.com/bloodf/durindoor/issues/1073) into a repeatable, read-only **mapping from each upstream merged source commit to its changed source paths and to the local DurinDoor code that already covers that path**. The unit covers the pinned reviewed window of 2026-09-30 → 2026-10-06 and reports four outcomes per row: directly evidenced already-covered, out-of-lane, unmapped, and uncertain. The OIDC dashboard sign-in row #15049 is classified under the separate **Provider Sign-in** owner lane and is not proposed for implementation here; the remaining in-lane candidates retain their static evidence below.

This is a documentation unit. No runtime code was added, no fixture was written, no provider was called, no credential was used, no network exposure was probed, and no upstream message was sent. Upstream access was limited to read-only GitHub API metadata.

The prior unit in this series, `1073-historical-source-provenance.md` (not present in this checkout; the surviving successor note is [`1073-historical-coverage-reconciled.md`](1073-historical-coverage-reconciled.md)), established the archive inventory (15,357 records, 8,409 merged PRs) and the window membership (266 merged PRs, 21 with local provenance, 245 with none). It did **not** read upstream diffs, so it could not say what the 245 uncovered rows actually changed. This unit closes that gap with source commit ids and static changed paths.

## 1. Headline result

All 266 window rows were re-derived from the GitHub API, mapped to their upstream merge commit and changed file list, and tested against the local tree.

| Outcome | Rows | Meaning |
| --- | --- | --- |
| **Already-covered** | **1** | Every behavioural source path of the row has a local counterpart file, and the upstream change is already present in it, verified line-for-line. |
| **Out-of-lane** | **102** | The row touches no behavioural path at all. Its changed source paths are i18n mirrors, docs, CI, tests, changelog, packaging, or dashboard UI only. |
| **Unmapped** | **63** | The row changes a behavioural source path, and no local counterpart file exists for it. |
| **Uncertain** | **100** | Mixed: 65 rows map some behavioural paths but not others, 12 rows map every path but only partially at line level, and 23 rows have a same-stem local alternative that needs a human read. |
| **Total** | **266** | Independently reproduced; see §2. |

Exactly one row is already covered end-to-end: **#15643** (`ebf312019`, `fix(quota): register the tracker batch after its binding is ready`). Its upstream change is a single import removal, and that import is already absent from the fork's `src/sse/handlers/chat.js` (§6.1). The window's own reviewed head, #15686, is *not* covered — its Trae change is absent from `open-sse/executors/trae.js`, so it sits in the uncertain bucket.

The important negative result is that **coverage in this window is much lower than the upstream titles suggest**, and that most of the window is not gateway work at all. 102 of 266 rows never touch a behavioural path. Of the 164 that do, exactly one is already covered end-to-end.

## 2. The window, re-derived rather than inherited

The prior unit recovered the 266 from the issue's own archive comment pages. This unit re-derived the same set from the upstream repository's own merge timestamps, which is the form that can be extended to earlier archive pages without re-parsing issue comments.

```bash
gh api -X GET search/issues \
  -f q='repo:cheaper-inference/OmniRoute is:pr is:merged merged:2026-09-30..2026-10-08' \
  -f per_page=100 --paginate \
  --jq '.items[] | [.number,.pull_request.merged_at,.title] | @tsv'
```

| Date | Merged PRs |
| --- | --- |
| 2026-09-30 | 4 |
| 2026-10-01 | 19 |
| 2026-10-02 | 63 |
| 2026-10-06 | 180 |
| 2026-10-07 | 59 |
| 2026-10-08 | 171 |

The pinned window is 2026-09-30 through 2026-10-06 inclusive, which selects **exactly 266** rows. The 2026-10-07 and 2026-10-08 rows exist in the same search but fall outside the reviewed window and are outside the archive's 2026-10-08 collection, so they are excluded. The count matches the prior unit's 266 independently.

Note that PR *number* does not order with merge date: the window contains ids from #12740 to #15697, and the lowest-numbered row in it merged on 2026-10-06. Any window query must filter on `merged_at`, never on number range.

## 3. The workflow

Four stages, all read-only. Bulk metadata stays on disk in a private scratch directory (mode `0700`) and is deliberately **not** committed; only the summary and direct source evidence are recorded here.

### Stage 1 — metadata (batched GraphQL)

For each window row, one batched GraphQL query returns the PR number, title, merge timestamp, base ref, additions/deletions, changed-file count, the **merge commit oid**, and the first 100 changed paths with per-file additions/deletions.

```graphql
query {
  repository(owner: "cheaper-inference", name: "OmniRoute") {
    p0: pullRequest(number: 15589) {
      number title mergedAt additions deletions changedFiles baseRefName
      mergeCommit { oid }
      files(first: 100) { totalCount nodes { path additions deletions } }
    }
    # …19 more aliases
  }
}
```

Batches of 20 PRs. 25 rows exceeded the 100-file page and were completed with a cursor-paginated follow-up query; after that, **no row in the window has a truncated file list**. The merge commit oid is the anchor that makes the mapping reproducible: it identifies the exact upstream tree state that the changed paths describe, independent of the PR number and of any later upstream history.

### Stage 2 — patches (REST, per file)

```bash
gh api "repos/cheaper-inference/OmniRoute/pulls/<n>/files?per_page=100&page=<p>"
```

The REST file payload carries a unified `patch` per file, which is what makes line-level coverage evidence possible (§4). A patch is flagged as truncated when the declared `changes` count exceeds the number of hunk lines actually returned.

### Stage 3 — local counterpart resolution

`git ls-files` gives the local tracked tree. An upstream path resolves to a local counterpart when the same path exists, or when only the extension differs (`.ts`/`.tsx`/`.mts` ↔ `.js`/`.jsx`/`.mjs`). The upstream tree and the fork share the `src/` and `open-sse/` layout, so most behavioural paths resolve directly; the fork's `.js` files replace upstream's `.ts` files.

Paths with no same-path counterpart are additionally tested for a same-stem local alternative under the same parent directory. These become *uncertain*, not *unmapped*: a module that upstream split out of a god-file may live inside a different fork module.

### Stage 4 — coverage test

For each upstream file that has a local counterpart, the upstream patch's **added** and **removed** source lines are compared against the local file, whitespace-normalised, ignoring blank, brace-only and comment-only lines.

A file counts as **covered** only when *both* halves hold:

- every non-trivial upstream **added** line is already present in the local file, and
- every non-trivial upstream **removed** line is already absent from the local file.

The removal half matters. A number of upstream fixes in this window are pure deletions (dropping a dead checkbox, dropping an unreachable fallback); a check that only looked for added lines would score those as uncovered.

Both halves are content evidence at the path level. **No title is ever used as evidence.** Upstream titles are used only to sort and to label rows for a human reader.

## 4. Lanes

A row is put in a lane by the **kind of source path it changed**, not by its title.

| Lane | Path rule | Changed-path entries | Rows touching the lane |
| --- | --- | --- | --- |
| gateway-core | `open-sse/**`, `src/lib/**`, `src/shared/utils/`, `src/shared/middleware/`, `src/sse/`, `src/mitm/`, `src/domain/`, `src/server/`, `src/models/` | 2,867 | 154 |
| api | `src/app/api/**` | 390 | 49 |
| ui | `src/app/(dashboard)/**`, `src/shared/components/`, `src/shared/ui/`, `src/shared/hooks/` | 560 | 40 |
| out | `src/i18n/`, `@omniroute/`, `changelog.d/`, `docs/`, `.github/`, `tests/`, `bin/`, `scripts/`, `config/`, packaging, `README`/`CONTRIBUTING`/`CHANGELOG`/`AGENTS`, `*.env.example`, `stryker`/`vitest`/`tsconfig` | 17,860 | 265 |
| other | paths outside every rule above | 561 | 41 |

**Behavioural surface** = gateway-core ∪ api, which is 3,257 changed-path entries across **164** rows. A row with no behavioural path is out-of-lane for a gateway port regardless of how large its diff is.

The out-of-lane composition is itself the finding: of the 17,860 out-of-lane path entries, 1,105 are `docs/i18n` mirrors, 137 are `src/i18n/`, 99 are `tests/unit/`, 50 are the OpenCode plugin bundle, 33 are `.github/workflows/`, 28 are `config/quality/`, and 26 are `changelog.d/fixes/`. This is OmniRoute's own documentation, localisation, test and CI apparatus, which a self-hosted gateway has no counterpart for. Those rows are not a porting backlog.

## 5. Cross-check against the prior provenance inventory

The prior unit found 21 window rows carrying local provenance (a `port(omniroute)` commit body, an `upstream-sync.mdx` disposition, or a later `1073-*` port report). The path classification cross-tabulates against that independently:

| Path class | With local provenance | Without |
| --- | --- | --- |
| Out-of-lane | 12 | 90 |
| Partially-mapped | 5 | 60 |
| Partially-covered | 2 | 10 |
| Unmapped | 2 | 61 |
| Already-covered | 0 | 1 |
| Uncertain | 0 | 23 |

Two things follow.

First, the 21 provenance rows are **not** the covered rows. Twelve of them are dependency, CI and i18n bumps that the dated review correctly skipped; the path classification independently confirms all twelve touch no behavioural path.

Second, **two rows the dated review already dispositioned are classified unmapped by path** — #15543 and #15566. The path classifier sees no local counterpart for their behavioural source paths and would flag them as gaps. The dated review in [`1073-existing-provider-request-residuals.md`](1073-existing-provider-request-residuals.md) says the opposite, on behavioural grounds: #15566 is "already addressed by a different contract" (the fork's `open-sse/translator/concerns/thinkingSuffix.js`, `open-sse/config/providerModels.js` and `open-sse/providers/registry/antigravity.js` already keep the tiered ids literal), and #15543 is an "inapplicable endpoint contract" (the fork's Command Code executor uses `/alpha/generate`, not upstream's `/provider/v1/messages`).

That disagreement is the point, and it is why this unit's path classifier is not allowed to close a row on its own. A path mapping says *where* to look; it cannot say *whether the behaviour is there*. The path classifier is right that these rows have no counterpart at the upstream path; the dated review is right that neither is a porting gap. Both facts are recorded here, and both rows are closed rather than carried.

## 6. Direct source evidence

Every claim below is a path-and-content fact read from the local tree and the upstream patch. No claim rests on a title.

### 6.1 Already covered

**#15643** — `ebf312019`, `fix(quota): register the tracker batch after its binding is ready`.
Upstream `src/sse/handlers/chat.ts` removes one line; that line is already absent from `src/sse/handlers/chat.js`. Full coverage, one added-line set empty, one removed-line set fully gone.

### 6.2 Out of lane, and out of lane for a structural reason

**#15452** — `6fc43757f`, `fix(api): stop restricted-key /v1/models leaking aggregator rows via names`.
Upstream introduces `src/app/api/v1/models/catalogKeyFilter.ts` and stops consulting a catalog row's `root` field when deciding key visibility. The fork has no `root` field at all in its catalog rows: `src/sse/services/modelAccess.js:64-77` filters on `entry.id` plus derived candidate names only, and `src/app/api/v1/models/buildModelsList.js` emits no `root`. The upstream defect (a namespaced `root` re-admitting another provider's row) is therefore **structurally absent** — this row is out-of-lane for the fork, not missing.

**#15415** — `7daf29601`, `fix(auth): keep a provider wildcard inside the provider it names`.
Upstream separates `cline/openrouter/<model>` (another provider reached through a gateway) from `cline/<family>/<model>` (the gateway's own model). The fork's `cline` registry (`open-sse/providers/registry/cline.js:39-55`) publishes two-segment vendor ids such as `anthropic/claude-opus-4.7` and `deepseek/deepseek-v4-flash`; there is no third segment that could carry a nested provider. The fork's glob matcher (`src/sse/services/modelAccess.js:20-29`) anchors the pattern to the whole name, so `anthropic/*` cannot match `cline/anthropic/claude-opus-4.7`. Out of lane by id shape.

### 6.3 Unmapped — behavioural path, no local counterpart

63 rows. The largest of them are upstream refactors into modules the fork never split out (`open-sse/services/combo/*`, `open-sse/executors/opencode*`, `src/lib/db/*`), which is why they are unmapped at path level but still require a behaviour read before any port. The in-lane candidates below draw on two rows that are unmapped at path level (#15231, #15337) and two rows whose upstream path maps but whose line-level check shows the change is absent (#15499, #15510). #15049 is retained as static evidence but belongs to Provider Sign-in.

### 6.4 Uncertain

All 23 uncertain rows are the same kind: the upstream behavioural source path has **no same-path counterpart**, but it does have a same-stem local alternative — upstream moved or split a module, and the fork keeps that behaviour under a different filename. These need a human read of the alternative file; they are neither covered nor gaps.

The alternatives are mostly close matches, which makes the rows cheap to close:

| Upstream path | Same-stem local alternative | Row |
| --- | --- | --- |
| `open-sse/services/freeProviderRankings.ts` | `open-sse/services/freeProviderRankings.js` | #15396 |
| `open-sse/handlers/search.ts` | `src/sse/handlers/search.js` | #15495 |
| `src/lib/providers/validation.ts` | `open-sse/services/compression/validation.js` | #15516 |
| `src/lib/services/quotaAutoPing.ts` | `src/shared/services/quotaAutoPing.js` | #15084 |
| `src/lib/memory/retrieval/scoring.ts` | `open-sse/services/quota/scoring.js` | #15549 |
| `src/lib/acp/registry.ts` | `open-sse/rtk/registry.js` | #15324 |

Separately, **21 rows** carry at least one file whose patch GitHub declined to return in full (the file is too large for the file-patch payload). Every one of those 21 is in the partially-mapped class, where the unreadable file does not change the outcome because the row already has behavioural paths without a local counterpart. No row's classification rests on an unreadable patch.

One of the 23 is a security row: **#15324** (`8489c9f49`, `fix(security): never put an escape-folded ACP version probe on a shell`). Its upstream path `src/lib/acp/registry.ts` has no counterpart in the fork — the fork has no `src/lib/acp/` tree at all — and the same-stem alternative `open-sse/rtk/registry.js` is a different registry entirely. That row needs a read, not an assumption.

## 7. Next concrete existing-feature fixes

These are fixes to features the fork **already has**. Each is stated with the local surface it touches, the upstream source commit it comes from, and acceptance conditions that can be checked without a live provider, a paid API, a credential, or network access. They are ordered by severity; they are not a selection list and require no owner choice to begin.

### 7.1 Provider Sign-in lane disposition: #15049

**Upstream:** #15049, `3efc28ea0`, `fix(auth): never sign anyone in through OIDC without an allowlist`.
**Upstream paths:** `src/app/api/auth/oidc/callback/route.ts`, `src/app/api/settings/route.ts`.
**Local surface:** `src/app/api/auth/oidc/callback/route.js:21-87`; settings persistence at `src/lib/db/repos/settingsRepo.js:65-69`.

**Disposition.** #15049 (`3efc28ea0`) changes the dashboard OIDC sign-in flow and is owned by the **Provider Sign-in** lane. The local callback and settings paths cited above remain useful static evidence for that lane. This report makes no implementation proposal or acceptance plan for the row.

### 7.2 Pair an unpaired Responses `function_call` instead of forwarding it bare

The gap and acceptance conditions below describe the historical comparison, not current behavior; the subsequent port is documented in [the tool-pairing report](1073-responses-historical-tool-pairing.md).

**Upstream:** #15231, `fca2f868129964a71004c185c1453864d5c2503f`, `fix(translator): pair unpaired Responses function_call items with synthetic outputs`.
**Upstream path:** `open-sse/translator/request/openai-responses/toResponses.ts` (+31/−1).
**Local surface:** `open-sse/translator/request/openai-responses.js`; existing self-check `open-sse/utils/openaiResponsesToolPairingSelfCheck.mjs`.

**Evidence of the gap.** The fork implements exactly one half of the repair. `open-sse/translator/request/openai-responses.js:94-101` removes a `function_call_output` whose `call_id` has no matching `function_call`, and the existing self-check asserts that strip in both directions. The mirror half is absent: no code path pairs a `function_call` that has no output. A Chat Completions request whose assistant turn carries `tool_calls` with no matching `tool` message therefore reaches a strict Responses upstream as a bare `function_call` item, which upstream rejects with 400 "No tool output found for function call &lt;id&gt;".

**Acceptance conditions.**

1. In the Chat Completions → Responses direction, an assistant turn whose `tool_calls` have no matching tool result produces exactly one `function_call_output` per unpaired call.
2. The synthesized item carries the call's own `call_id`, `output: ""` and `status: "completed"`.
3. The synthesized output is placed immediately after its `function_call` in the input array, and the `function_call` item itself survives the translation unchanged.
4. A properly paired call keeps its real output and gains no second, synthesized output.
5. The existing orphan-output strip is unchanged: no double repair, no duplicated warning, and the orphan strip still removes a `function_call_output` with no owning call.
6. The passthrough direction (`openaiResponsesToOpenAIRequest`) is unchanged.
7. Synthetic coverage extends `open-sse/utils/openaiResponsesToolPairingSelfCheck.mjs` (or a sibling self-check) to assert points 1–5 offline.

### 7.3 Guard against replayed Responses events whose sequence is a string

**Upstream:** #15510, `408b4f2bd`, `fix(sse): drop a replayed responses event when the sequence is a string`.
**Upstream path:** `open-sse/utils/stream.ts`.
**Local surface:** `open-sse/utils/stream.js:154` (`createSSEStream`).

**Evidence of the gap.** Upstream keeps a `lastSeenResponsesSequenceNumber` and drops an event whose sequence number is not greater than the last one. The fork's `createSSEStream` has no sequence-number tracking at all: `grep sequence_number` over `open-sse/utils/stream.js` matches only the literal `sequence_number: 0` on the synthetic `response.failed` frame it builds at line 130, and the only duplicate tracking in the file is `streamDoneSent` for the `[DONE]` sentinel (`stream.js:545`). The upstream change is that a sequence number arriving as a numeric **string** (`"7"`) is normalised to a number before the comparison. Before that change a string sequence never matched the guard, so a replayed event passed through even though upstream already had the guard in place.

**Acceptance conditions.**

1. The fork's SSE stream factory tracks the last seen Responses sequence number and drops a Responses event whose sequence is not strictly greater than the last one.
2. A sequence given as a decimal string is normalised before comparison, so `"7"` after `7` is treated as a replay and dropped.
3. A sequence that is not a safe integer — a non-numeric string, a float, `NaN`, `Infinity` — is not treated as a replay and does not disturb the tracked value.
4. The `[DONE]` sentinel handling and `streamDoneSent` are unchanged.
5. The guard applies to both the translate path and the Responses passthrough path, matching upstream's placement inside `createSSEStream`.
6. Synthetic coverage feeds a scripted event sequence and asserts the dropped and forwarded events.

### 7.4 Choose the Copilot endpoint from the catalog's endpoint contract

**Upstream:** #15337, `cee37af66`, `fix(sse): preserve Copilot discovered endpoint routing`.
**Upstream path:** `open-sse/services/githubCopilotModels.ts`.
**Local surface:** `open-sse/services/catalogs/copilotModels.js:69-88` (`expandCatalog`), `open-sse/executors/github.js:143-151` (`supportsResponsesEndpoint`), `github.js:182-186` (the `/responses` route selection).

**Evidence of the gap.** The fork's `expandCatalog` filters on `m.capabilities?.type !== "chat"` and, when metadata is requested, copies the raw `m.capabilities` object onto the model (`copilotModels.js:74-83`), so the upstream endpoint data may already be present in the fork's catalog. What is missing is the consumer. Endpoint selection in `open-sse/executors/github.js` is driven by `this.knownCodexModels` — a set the executor fills at runtime from an escalation signal (`github.js:210`) — combined with the name-based `supportsResponsesEndpoint` check. Upstream instead derives `supportedEndpoints` and `targetFormat` from the catalog row and routes by the endpoint contract, so a model whose catalog row declares `responses` and not `chat` is routed to `/responses` regardless of its name.

**Acceptance conditions.**

1. The catalog expansion normalises `supported_endpoints` — read from the row itself or from `capabilities.supported_endpoints` — into a sorted set of endpoint kinds, mapping `chat/completions`, `chat-completions` and `messages` to `chat` and stripping a leading `/v1/`.
2. A row whose normalised endpoint set contains `responses` and not `chat` yields a target format of `openai-responses`; a row with no endpoint data yields no endpoint metadata.
3. When the catalog provides endpoint metadata for a model, the executor selects the endpoint from that contract. When it does not, the existing `knownCodexModels` and name-pattern rules remain the fallback, unchanged.
4. A model that declares only `chat` is never routed to `/responses`.
5. The Claude and Gemini exclusion from `/responses` (`github.js:143-151`) is unchanged, and the `/v1/messages` route for Claude models is unchanged.
6. Synthetic coverage feeds catalog rows with and without `supported_endpoints` and asserts the selected endpoint, with no live Copilot call.

### 7.5 Declare the GHE Copilot target format for `gpt-6*` ids

**Upstream:** #15499, `ac8113d50`, `fix(executors): route GHE Copilot GPT-6 models to Responses`.
**Upstream paths:** `open-sse/config/providerModels.ts`, `open-sse/executors/ghe-copilot.ts`.
**Local surface:** `open-sse/config/providerModels.js:73-82` (`getModelTargetFormat`), `open-sse/executors/ghe-copilot.js:1-41`, `open-sse/providers/registry/ghe-copilot.js`.

**Evidence of the gap.** The fork's `getModelTargetFormat` resolves a per-model `targetFormat` from the provider registry and otherwise returns `null`, with special cases only for Minimax and OpenCode Zen. There is no `ghe-copilot` rule. The `ghe-copilot` registry declares no per-model `targetFormat` either. Upstream's rule is narrow on purpose: only `ghe-copilot`, only ids matching `gpt-6*`, and only when the id is not Gemini or Claude — because upstream's GHE Copilot executor sends an unregistered `gpt-6*` id to `/responses`, while a missing catalog tag would leave the body in Chat Completions shape (`messages`, `max_tokens`), which `/responses` rejects. The fork's GHE Copilot executor inherits `GithubExecutor`'s routing, so the same mismatch is reachable when a `gpt-6*` id is not in the runtime-learned set.

**Acceptance conditions.**

1. `getModelTargetFormat("ghe-copilot", <id>)` returns `openai-responses` for an id matching `gpt-6*` that does not match `gemini` or `claude`, and does not change the result for any other provider.
2. A `ghe-copilot` id matching `gpt-6*` that also matches `claude` or `gemini` is not routed to `/responses`.
3. A registry-declared `targetFormat` still takes precedence over the new rule, matching the existing precedence in `getModelTargetFormat`.
4. The `github` provider's own routing is unaffected — upstream keeps this rule `ghe-copilot`-only because `github.com` Copilot does not use the same URL predicate.
5. The GHE Copilot executor's `/v1/messages` route for Claude models and its `/chat/completions` default are unchanged.
6. Synthetic coverage calls `getModelTargetFormat` directly for the accepted and rejected id shapes, with no live Copilot call.

### Out of this tranche

- New providers, new endpoints and new integrations. A new provider is a catalogue addition, not a fix to an existing feature.
- Sign-in and OAuth flows, including #15049, which belongs to the Provider Sign-in lane.
- The dashboard and i18n surface of the upstream rows.
- The 65 partially-mapped rows and the 23 same-stem rows: each needs an individual behaviour read before it can be called a gap, and none has been read here.
- #12620 and any other row with a separate defensive unit already open.

## 8. Release branch divergence

The window is anchored to one upstream commit, and that commit does not sit on any tag. Verified read-only against the upstream repository:

| Anchor | Relationship to `77bca6f878180006f3a679b53400d55a344fcd83` | Consequence |
| --- | --- | --- |
| `77bca6f8` itself | commit dated 2026-10-06T21:55:11Z; the squash of upstream PR #15686 | The window's last reviewed upstream state. |
| `release/v3.8.52` (branch head) | **ahead 1,177 / behind 0** | The reviewed head is an ancestor of the branch it was reviewed against. Nothing reviewed was later rewritten on that branch. |
| `release/v3.8.55` (current default branch) | **ahead 4,078 / behind 0** | The reviewed head is still contained in the current default branch, 4,078 commits behind. It is not orphaned and did not fall off the branch. |
| `v3.8.52` (**tag**) | **diverged, +5 / −5,213** | The tag does not identify the reviewed head. It carries 5 commits the reviewed head does not have and lacks 5,213 commits the reviewed head does. |

Two consequences for this mapping.

First, a **branch** and a **tag** of the same version name are different trees here. Any comparison that pins `v3.8.52` is comparing against a 5,213-commit-older ancestor than the reviewed head, and would understate everything the window contains. The window must be anchored to the commit id, which is why the merge commit oid is the primary key throughout this unit.

Second, the upstream **merge commit ids are the stable identity**. A PR number can be reused in the archive's accounting across snapshots; a merge commit oid cannot. Rows in §7 are therefore keyed by both, and the oids are the values that let a later unit re-derive the same changed-path set without trusting any local note.

## 9. Bounded API use

Everything here is read-only against public GitHub endpoints, with a bounded footprint and no credential beyond the ordinary read token already used for the repository.

| Stage | Requests | Budget consumed | Notes |
| --- | --- | --- | --- |
| Window re-derivation | 3 (`search/issues`, paginated) | ~3 core | One query per date range; paginates at 100 per page. |
| Metadata | **14 GraphQL requests** | **158 GraphQL points** | 20 PRs per request; cursor-paginated follow-ups for the 25 rows with more than 100 changed files. |
| Patches | **457 REST pages** | ~457 core | 100 files per page, one pass; 22,238 changed-file entries retrieved for the 266 rows. |
| Branch divergence | 3 `compare` + 1 `commits` | ~4 core | Read-only. |
| Local tree | 0 | — | `git ls-files` plus targeted reads; no upstream checkout was made. |

Measured core usage across the whole unit was 2,424 requests, of which roughly 1,375 were spent in a discarded first attempt that combined `gh api --paginate` with an explicit `page=` parameter and so requested each page twice; the retained workflow needs about 470 core requests for the window. The GraphQL cost is the cheap half — 14 requests, 158 points — and it is what carries the merge commit ids and the full changed-path lists.

Deliberately not done: no upstream repository clone, no `git fetch` of upstream history, no provider call, no credential material read, no issue or PR comment, no release or tag write, no Docker build, no browser session. The upstream side of this unit is metadata only.

## 10. Scaling to earlier archive pages

The archive behind #1073 holds 8,409 merged OmniRoute PRs, spanning 2026-02-13 → 2026-10-08, collected across 38 comment pages. This method extends to it without re-parsing any issue comment, because the window query filters on merge timestamp rather than on archive membership.

**The window query is the only part that changes.** Replace the date range and the row count follows from the API:

```bash
gh api -X GET search/issues \
  -f q='repo:cheaper-inference/OmniRoute is:pr is:merged merged:<START>..<END>' \
  -f per_page=100 --paginate \
  --jq '.items[] | [.number,.pull_request.merged_at,.title] | @tsv'
```

`search/issues` returns at most 1,000 rows per query, so an early window is split into date ranges of roughly a month, and each range is verified against the following range's boundary to make sure no row is counted twice or dropped. `merged:` is inclusive of both endpoints, which is why this unit used `..2026-10-08` and then filtered to `< 2026-10-07`: the archive's collection day and the window's end day differ, and the boundary has to be set deliberately rather than inherited.

**Cost projection for the full archive**, measured from the 266-row unit and scaled:

| Stage | 266 rows | 8,409 rows (×31.6) | Constraint |
| --- | --- | --- | --- |
| Metadata (GraphQL) | 14 requests / 158 points | ~442 requests / ~5,000 points | Fits one GraphQL window at the measured point rate. |
| Patches (REST core) | 457 pages | ~14,400 pages | **Exceeds the 5,000/hour core budget.** |

So the metadata sweep scales to the whole archive in one pass, and the **patch fetch does not** — it must be either budgeted across at least three hours or restricted.

The recommended shape for the earlier pages is a two-tier sweep, and it is the same shape this unit used at window scale:

1. **Metadata tier, all rows.** GraphQL merge commit id and changed-path list for every merged PR. This is cheap, gives the commit ids, and is enough to place every row into a lane and to answer "does this row touch a behavioural path at all".
2. **Patch tier, behavioural rows only.** In this window, 164 of 266 rows (62%) had a behavioural path. Restricting the patch fetch to that subset cuts the REST cost by roughly 38% before pagination overhead. For the full archive that is still large, so the patch tier should be run **per historical window**, in the same batches as the metadata tier, rather than as one sweep.
3. **Coverage tier, read locally.** The line-level test runs against the local tree and costs nothing upstream. It is the part that can be re-run at any time against any upstream revision without spending API budget.

**Two limits on what scaling can claim.** First, the earlier pages sit upstream of the `77bca6f8` anchor, and the fork's own history does not reach back to them uniformly — a row from 2026-02 may correspond to behaviour the fork has since rewritten, which the line-level test reports as *partial* rather than *covered*, correctly, but which still needs a read. Second, and more important: the archive is a 2026-10-08 snapshot, so PRs merged after that date sit in the archive's OPEN bucket, and PRs numbered above #15,937 are absent from it entirely. An archive-derived count and an API-derived count will differ unless the same merge-timestamp filter is applied to both, and only the API-derived count is reproducible.

## 11. What this unit does not claim

- **Nothing was ported.** No runtime code was added or changed; no fixture was written; no upstream merge was performed.
- **No provider was called and no behaviour was observed at runtime.** Every coverage statement is a static comparison of upstream patch lines against local source lines. "Already covered" means the upstream change is present in the local file, not that a request was observed to behave that way.
- **The 63 unmapped rows are not 63 gaps.** Unmapped means no local counterpart file exists for the upstream path. The fork's architecture differs from upstream's in many places, so an unmapped row frequently corresponds to behaviour the fork implements in a different module. The in-lane candidates draw on two unmapped rows and two partially-covered rows whose behaviour was actually read in the fork; the other 59 unmapped rows were not read. #15049 remains Provider Sign-in lane evidence, not an in-lane candidate.
- **The 100 uncertain rows are not evidence of anything in either direction.** They need a read of the same-stem local alternative, or of the upstream diff, before they can be classified.
- **No title was treated as a disposition.** Titles appear in this report only as labels for rows a human will read.
- **Two rows that the path classifier flags as unmapped are closed by a dated behavioural review** — #15543 and #15566, both dispositioned in `1073-existing-provider-request-residuals.md` as already-addressed and inapplicable respectively. The disagreement between the two methods is recorded in §5; neither method overrides the other, and neither row is carried forward as a gap.

## 12. Reproducing this unit

The scratch directory for this unit was `/tmp/durindoor-1073-pathcov-2KNi1LZh` (mode `0700`, disk-backed). It holds the window query output, the per-batch GraphQL responses, the per-PR patch payloads, the resolved path map and the per-row classification. It is intentionally **not** committed: it is bulk metadata, and the report above is the summary plus the direct source evidence.

To re-derive the window mapping against a different upstream revision or a different local tree, re-run the four stages in §3 with the same scripts' logic. The merge commit ids in §6 and §7 are the stable keys; the merge timestamps are the stable window boundaries; the upstream patch content is the stable evidence. Nothing in the method depends on a local note, a scratch file, or an issue comment surviving.

Refs #1073
