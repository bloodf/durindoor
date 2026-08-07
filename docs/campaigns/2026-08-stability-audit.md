# Stability Port Campaign — Pre-Repair Audit Snapshot

> **Historical document snapshot, not a current readiness verdict.** Two
> immutable document blobs preserve the 2026-08-05 record: the
> [audit report at `79fb45ccca71187202ff3347bfe2856b6b93c624`](https://github.com/bloodf/durindoor/commit/79fb45ccca71187202ff3347bfe2856b6b93c624)
> and the [terminus ledger at `e03a8d610e18d32931ca50cf51b1de76c3a208cc`](https://github.com/bloodf/durindoor/commit/e03a8d610e18d32931ca50cf51b1de76c3a208cc).
> The old rewritten port commits and test/commitlint command outputs lack retained
> immutable provenance. Treat their claims as unreproducible historical notes.
> Current readiness requires a new audit of final pushed branch tips with Node
> 20.20.2/npm 10.8.2.

**Date:** 2026-08-05
**Target:** 8-theme stability port campaign for `bloodf/durindoor` (fork of `decolua/9router`, cross-fork source `diegosouzapw/OmniRoute`)
**Current PR #396 checkout example:** `/home/cortexos/.omp/wt/396-54e088a` on 2026-08-07; rediscover with `git worktree list --porcelain` because this path is not durable
**Historical campaign terminus ledger:** [`e03a8d610e18d32931ca50cf51b1de76c3a208cc`](https://github.com/bloodf/durindoor/commit/e03a8d610e18d32931ca50cf51b1de76c3a208cc); current PR diffs and checks do not prove old source/test bytes or command results
**Model disclosure:** Parent synthesis ran on `durindoor/cx/gpt-5.6-sol`. Delegated reviewer subagents were frequently routed to `durindoor/cc/claude-opus-4-8` by the task harness; the substitution is noted in this report as required by the review handoff.

```yaml
snapshotStatus: HISTORICAL_DOCUMENT_BLOBS_REPRODUCIBLE_COMMAND_EVIDENCE_UNAVAILABLE
supportedRuntimeRecheck: PENDING_NODE_20_20_2_NPM_10_8_2
historicalAuditReport:
  commit: 79fb45ccca71187202ff3347bfe2856b6b93c624
  portsReviewed: 9
  duplicatesSpotChecked: 95
  defersSpotChecked: 202
historicalTerminusLedger:
  commit: e03a8d610e18d32931ca50cf51b1de76c3a208cc
  themes: [sse-streaming, translator, combo-routing, auth-oauth, db-usage, provider-fixes]
  candidates: 285
  ports: 8
  duplicates: 92
  defers: 185
  omittedThemes: [resilience, mcp-gateway]
historicalOperationalClaims:
  knownFailsBaseline: "report says 0 lines; command output unavailable"
  preExistingEnvFailuresReproduced: []

findings:
  - severity: Critical
    theme: campaign-documents
    pr: "#396"
    location: "docs/campaigns/2026-08-stability-review-handoff.md"
    issue: >
      At audit time, the review handoff cited a nonexistent campaign plan. The
      committed source is now
      docs/campaigns/2026-08-stability-repair-handoff.md, and the review handoff
      points to it. This finding records the pre-repair defect rather than a
      current dead reference.
    recommendation: >
      Keep campaign instructions anchored to the committed repair handoff and
      verify its presence in the final PR tree.

  - severity: Critical
    theme: resilience
    pr: "#393 / #1821"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: resilience"
    issue: >
      The resilience section is corrupt: it lists 15 rows but only 14 distinct
      candidates because #1821 is duplicated. It also cites a phantom #3012 in
      the summary that has no corresponding row. The cited test
      tests/unit/codex-permanent-refresh.test.js does not exist; the actual test
      is tests/unit/oauth-classify-token-expired.test.js. The PR body and
      ledger summary therefore publish false counts and a false test citation.
    recommendation: >
      Rebuild the resilience ledger from the live PR diff, remove the duplicate
      #1821 row, either add or delete the #3012 reference, and correct the test
      citation before any merge.

  - severity: Critical
    theme: combo-routing
    pr: "ledger-only"
    location: "historical audit blob: former port/combo-routing-stability tip"
    issue: >
      The immutable audit report says the 62-row combo-routing ledger existed
      only on one local lineage and not on the inspected branch tip, whose ledger
      contained only SSE and translator themes. The report blob preserves that
      claim; its cited old branch-tip source objects are not retained as published
      evidence, so recheck current lineage before acting.
    recommendation: >
      Rebuild the combo-routing conclusion from the current branch and PR diff.
      Replay the 62-row ledger only if current evidence supports it. Do not
      report a combo count without a ledger on the current branch HEAD.

  - severity: Critical
    theme: mcp-gateway
    pr: "ledger-only"
    location: "port/mcp-gateway-stability"
    issue: >
      The immutable terminus ledger contains six themes and omits resilience and
      mcp-gateway, matching the historical report's statement that MCP-gateway
      had no PR or merge path. Verify current completeness from the current #395
      diff before acting.
    recommendation: >
      Either create an MCP PR with the ledger-only deferrals or remove the claim
      that the campaign records all eight themes. Do not merge a cumulative
      ledger that silently drops two themes.

  - severity: Critical
    theme: provider-fixes
    pr: "#395"
    location: "PR #395 body and terminus ledger"
    issue: >
      #395 claims a zero-port / ledger-only / no-tests scope, but its diff and
      ancestry inherit open-sse/services/provider.js and
      tests/translator/format-detection.test.js, visible in
      [PR #394](https://github.com/bloodf/durindoor/pull/394) and
      [PR #395](https://github.com/bloodf/durindoor/pull/395), from a stale-v3.9.1
      format-detection port. The current main already handles anthropic-version
      via #389, making the inherited code redundant or divergent. The PR body
      is therefore inaccurate and the branch is not ledger-only.
    recommendation: >
      Rebase the provider-fixes branch on current main, drop the redundant
      format-detection code, and rewrite the PR body to match the real diff.

  - severity: Critical
    theme: auth-oauth
    pr: "ledger-only"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: auth-oauth (46 rows)"
    issue: >
      The auth-oauth ledger contains numerous fabricated or inverted citations.
      Examples confirmed: #1883 cites a nonexistent cli-tools route; #641 confuses
      Qoder with Qwen Code and the qwen-code alias is absent; #1249 remote
      redirect handling is absent; #717 is only a partial implementation; #2966,
      #2979, #2919, #2210, #1288, #1158, #665 are deferred despite behavior
      being duplicate or already present; #3005, #1340, #646 are compact/partial
      GAPs mislabeled as DEFER. Reviewers disagreed on taxonomy for several
      partial bundles, so no trustworthy corrected total can be published.
    recommendation: >
      Rebuild the auth-oauth ledger row-by-row with live diff verification and
      remove all fabricated or stale citations. Do not publish a definitive
      0/11/35 total until the disputed bundles are resolved.

  - severity: Critical
    theme: db-usage
    pr: "#394"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: db-usage (#424)"
    issue: >
      #424 is deferred as a configurable history cap, but the cited evidence
      points to the wrong table (requestDetails.json) and the actual upstream
      change concerns usage history truncation. Other rows (#1738, #2137,
      #2150, #2153) are deferred despite behavior being present in DurinDoor. The
      semantic summary differs from the ledger, so the 0/16/22 arithmetic is not
      source-backed.
    recommendation: >
      Re-audit the DB-usage rows against the live upstream PR diffs and usage
      service source, correct the #424 citation, and reclassify rows that are
      genuinely duplicate.

  - severity: Critical
    theme: translator
    pr: "#392"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: translator"
    issue: >
      Multiple DUPLICATE classifications are not source-backed: #2762 (reasoning
      price differential absent), #628 (schema default stripping absent), #1193
      (MCP namespace pipeline absent), #2001 (antigravity thinking-format branch
      absent), and #1264 (cited temperature guard absent). The as-written
      4/22/22 arithmetic passes but the semantic counts do not.
    recommendation: >
      Flip the misclassified rows to GAP or DEFER with specific evidence, re-run
      the translator-focused tests, and update the ledger before merge.

  - severity: Important
    theme: sse-streaming
    pr: "#391 / #3020"
    location: "unreproducible historical note about the former PR #391 history"
    issue: >
      The 2026-08-05 notes alleged that a follow-up commit mixed #3020 source
      changes with #721 test edits and omitted the upstream PR URL. Branch
      rewriting removed the old commit, and the audit retained no immutable
      commit or patch artifact, so this commit-isolation claim cannot be
      reproduced from current PR #391 history.
    recommendation: >
      Inspect the current [PR #391 diff](https://github.com/bloodf/durindoor/pull/391/files)
      and [checks](https://github.com/bloodf/durindoor/pull/391/checks). Require
      isolation fixes only when current immutable commit IDs and diffs support them.

  - severity: Important
    theme: sse-streaming
    pr: "#391 / #1148"
    location: "tests/unit/sse-null-frame.test.js"
    issue: >
      The regression test for #1148 does not import registerAll.js, violating
      AGENTS.md §4.4. Under vitest/ESM the translator registry may silently
      no-op, causing a false pass.
    recommendation: >
      Add import "./registerAll.js" at the top of the test file and re-run.

  - severity: Important
    theme: sse-streaming
    pr: "#391 / #721"
    location: "open-sse/transformer/responsesTransformer.js:88-92"
    issue: >
      The completed-output port does not set status:"completed" on
      function_call items in responsesTransformer, and normalizeOutputIndex
      accepts negative and float indices while the upstream guard is defensive
      about them. The existing test covers only one message item per path, not
      function calls, dense ordering, duplicate indices, or sparse indexes.
    recommendation: >
      Add the upstream guard to normalizeOutputIndex, set status:"completed" on
      function_call items, and expand tests to cover function calls and index
      edge cases.

  - severity: Important
    theme: translator
    pr: "#392 / #3018"
    location: "open-sse/translator/formats/gemini.js:25"
    issue: >
      removeUnsupportedKeywords() is position-blind: it recurses into properties
      maps and deletes legitimate tool parameters named contains or uniqueItems,
      then a cleanup pass removes them from required. The test only checks list
      membership, not the property-name preservation or cleanup behavior.
    recommendation: >
      Scope the keyword removal to the JSON-schema dialect level, preserve
      property names, and add tests that exercise nested properties and required
      cleanup.

  - severity: Important
    theme: translator
    location: "unreproducible historical note about the former PR #392 history"
    pr: "#392 / #422"
    issue: >
      The 2026-08-05 notes alleged that the #422 commit also edited Codex
      comments belonging to #1425. Branch rewriting removed the old inspected
      commit, and no immutable commit or patch artifact was retained. Current PR
      #392 history cannot prove that historical commit-isolation claim.
    recommendation: >
      Inspect the current [PR #392 diff](https://github.com/bloodf/durindoor/pull/392/files)
      and [checks](https://github.com/bloodf/durindoor/pull/392/checks). Change
      current history only if current immutable commit IDs and diffs show mixing.

  - severity: Important
    theme: resilience
    pr: "#393 / #1821"
    location: "tests/unit/oauth-classify-token-expired.test.js"
    issue: >
      Both marker-based assertions use status 401, so the 401 short-circuit
      makes them pass even if the marker-detection branch is removed. The marker
      contract (token_expired / unauthorized_client) is therefore unguarded.
    recommendation: >
      Add a test that asserts the marker classification with a non-401 status
      (e.g., 400 or 403) so the marker branch is independently exercised.

  - severity: Important
    theme: provider-fixes
    pr: "ledger-only"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: provider-fixes"
    issue: >
      High-confidence misclassifications: #2761 is labeled DUPLICATE but the
      cited GitHub executor architecture is old and the dynamic target format is
      absent (GAP); #1573 Kiro tool-argument buffering is absent (GAP); #2904
      is labeled DUPLICATE but the correct outcome is a deliberate DEFER;
      #2988/#2943 duplicate behavior is largely present but #2663, #2314, #2183,
      #2753, #2685, #2667 are deferred despite being present. Multiple genuine
      GAPs (#1418, #1383, #1349, #1346, #1316, #1209) are mislabeled DEFER.
      #3023 and other rows contain fabricated or stale scope descriptions.
    recommendation: >
      Re-audit provider-fixes against live upstream diffs and the current DD
      executor code, reclassify each row with file:line evidence, and remove
      fabricated scope claims.

  - severity: Important
    theme: sse-streaming
    pr: "#391"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: sse-streaming"
    issue: >
      Citation defects on #8948 and #9003: the evidence does not match the live
      upstream diff. Several DEFER rows use generic reasons ("multi-file
      refactor", "too large") without naming the subsystem or file scope. The
      count also drifts from 49 candidates in some summaries to 52 in others.
    recommendation: >
      Correct the #8948/#9003 evidence, replace generic defer reasons with
      specific subsystem + file scope, and reconcile the candidate count across
      all summaries.

  - severity: Important
    theme: sse-streaming
    pr: "#391 / #651"
    location: "open-sse/handlers/chatCore/nonStreamingHandler.js:308-310"
    issue: >
      #651 was classified DUPLICATE using inverted evidence. DurinDoor's own
      function contract defines sourceFormat as the upstream format and
      targetFormat as the client format, but the Ollama conversion incorrectly
      checks targetFormat. The upstream bug remains present, so this row is a
      GAP rather than a DUPLICATE.
    recommendation: >
      Port the sourceFormat guard with an Ollama non-streaming response test,
      then update the ledger evidence and verdict.

  - severity: Minor
    theme: mcp-gateway
    pr: "ledger-only"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: mcp-gateway"
    issue: >
      Minor evidence imprecision: #9162 evidence describes authHeaders extraction
      rather than server.ts code; upstream path prefixes are wrong on #8925 and
      #9162. The 0/1/6 arithmetic is otherwise source-backed.
    recommendation: >
      Correct the cited files and path prefixes in the MCP ledger.

  - severity: Minor
    theme: db-usage
    pr: "#394"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: db-usage"
    issue: >
      #1738, #2137, #2150, and #2153 are deferred despite being actually
      DUPLICATE in current DD. The semantic corrected minimum is at least 1 GAP
      (#2811) and several DUPLICATE flips.
    recommendation: >
      Flip the verified duplicate rows and re-run the db-usage focused checks.

  - severity: Minor
    theme: combo-routing
    pr: "ledger-only"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: combo-routing"
    issue: >
      The combo ledger has 62 rows and arithmetic 10 duplicate / 52 defer, but
      the section lacks the required Verdict/Count/PR and source-split summary
      tables that every other theme includes. Individual rows #339 and Omni #9027
      are compact GAPs mislabeled as broad DEFER; #1813 should be DUPLICATE.
    recommendation: >
      Add the missing summary tables and reclassify the confirmed compact GAPs.

  - severity: Minor
    theme: auth-oauth
    pr: "ledger-only"
    location: "docs/campaigns/stability-port-2026-08-ledger.md — Theme: auth-oauth"
    issue: >
      #1883 cites a nonexistent CLI route; #641 confuses Qoder with Qwen Code;
      #1249 remote redirect handling is absent. These are concrete citation
      defects that undermine trust in the 0/11/35 summary.
    recommendation: >
      Fix the three named citations and re-audit the remaining deferred rows.

concerns:
  - >
    The immutable terminus ledger at e03a8d610e18d32931ca50cf51b1de76c3a208cc
    contains six themes and omits resilience and mcp-gateway. Its mechanically
    summed theme totals are 285 candidates: 8 ports, 92 duplicates, 185 defers.
  - >
    The immutable audit report describes two local branch lineages. Its named old
    source commits are not all retained as published evidence, so rebuild current
    ancestry conclusions from current immutable commit IDs before acting.
  - >
    The review handoff cited a nonexistent plan during the historical audit. It
    now points to docs/campaigns/2026-08-stability-repair-handoff.md. The final
    audit must verify that source at repaired branch tips.
  - >
    The audit report says tests/__baseline__/known-fails.txt had 0 lines and
    commitlint passed on eight worktrees. No retained command output reproduces
    those operational claims. Run both checks on current final tips.

cleanOriginAttribution:
  - path: tests/unit/security-hardening.test.js
    status: unreproducible-historical-note; supported-runtime-recheck-pending
    evidence: >
      The notes reported 20/20 passing on clean origin/main with Node
      v24.19.0/npm 12.0.2, but retained no immutable tree ID and command output.
      Node 24 is unsupported. Re-run on the current immutable origin/main commit
      with Node 20.20.2/npm 10.8.2 and preserve output.
  - path: tests/unit/xai-oauth-service.test.js
    status: unreproducible-historical-note; supported-runtime-recheck-pending
    evidence: >
      The notes reported 5/5 passing in the same environment, but retained no
      immutable tree ID and command output. Re-run on the current immutable
      origin/main commit with Node 20.20.2/npm 10.8.2 and preserve output before
      assigning pass, failure, or pre-existing status.

verdict: HISTORICAL_REJECT_PENDING_FINAL_BRANCH_TIPS
```

## Scope and method

The immutable audit-report and terminus-ledger blobs preserve historical
document bytes and make their text and ledger arithmetic reproducible with
`git show`. They do not preserve old rewritten port patches or command output.
Treat historical test, gate, and commit-isolation statements as unaudited notes
until current immutable source and newly retained output confirm them.

Work reviewed:

| Theme | Worktree / branch | PR | Notes |
|-------|-------------------|----|-------|
| sse-streaming | `port/sse-streaming-stability` | #391 | 4 ports, 4 focused tests |
| translator | `port/translator-stability` | #392 | 4 ports, 4 focused tests |
| resilience | `port/resilience-stability` | #393 | 1 port, 1 focused test |
| combo-routing | `port/combo-routing-stability` | none | ledger-only; divergent lineage |
| mcp-gateway | `port/mcp-gateway-stability` | none | ledger-only; no merge path |
| auth-oauth | `port/auth-oauth-stability` | none | ledger-only |
| db-usage | `port/db-usage-stability` | #394 | ledger-only, but PR diff carries inherited code |
| provider-fixes | `port/provider-fixes-stability` | #395 | ledger-only, but PR diff carries inherited code |

The historical audit and terminus ledger documents are retained. The old source
patches and command-output bundle are not. Current mutable PR pages help locate
today's diff and checks but do not prove source or test results from 2026-08-05.

## Historical port notes and current inspection links

| Theme | Upstream PR | Current PR diff | Current checks | Historical test note | Provenance status |
|-------|-------------|-----------------|----------------|----------------------|-------------------|
| sse-streaming | #3020 | [#391 current diff](https://github.com/bloodf/durindoor/pull/391/files) | [#391 current checks](https://github.com/bloodf/durindoor/pull/391/checks) | `sse-to-json-cache-tokens-3020.test.js`; reported in 14-test run | old commit and output unavailable |
| sse-streaming | #1272 | [#391 current diff](https://github.com/bloodf/durindoor/pull/391/files) | [#391 current checks](https://github.com/bloodf/durindoor/pull/391/checks) | `resolve-stream-flag.test.js`; reported in 14-test run | old commit and output unavailable |
| sse-streaming | #1148 | [#391 current diff](https://github.com/bloodf/durindoor/pull/391/files) | [#391 current checks](https://github.com/bloodf/durindoor/pull/391/checks) | `sse-null-frame.test.js`; reported pass with coverage defect | old commit and output unavailable |
| sse-streaming | #721 | [#391 current diff](https://github.com/bloodf/durindoor/pull/391/files) | [#391 current checks](https://github.com/bloodf/durindoor/pull/391/checks) | `responses-completed-output.test.js`; reported pass with incomplete coverage | old commit and output unavailable |
| translator | #3018 | [#392 current diff](https://github.com/bloodf/durindoor/pull/392/files) | [#392 current checks](https://github.com/bloodf/durindoor/pull/392/checks) | `gemini-schema-multiple-of.test.js`; reported in 30-test run | old commit and output unavailable |
| translator | #1425 | [#392 current diff](https://github.com/bloodf/durindoor/pull/392/files) | [#392 current checks](https://github.com/bloodf/durindoor/pull/392/checks) | `codex-effort-wire.test.js`; reported in 30-test run | old commit and output unavailable |
| translator | #1337 | [#392 current diff](https://github.com/bloodf/durindoor/pull/392/files) | [#392 current checks](https://github.com/bloodf/durindoor/pull/392/checks) | `reasoningContentInjector.test.js`; reported in 30-test run | old commit and output unavailable |
| translator | #422 | [#392 current diff](https://github.com/bloodf/durindoor/pull/392/files) | [#392 current checks](https://github.com/bloodf/durindoor/pull/392/checks) | `openai-schema-numeric-constraints.test.js`; reported pass with isolation concern | old commit and output unavailable |
| resilience | #1821 | [#393 current diff](https://github.com/bloodf/durindoor/pull/393/files) | [#393 current checks](https://github.com/bloodf/durindoor/pull/393/checks) | `oauth-classify-token-expired.test.js`; reported 3-test pass with weak assertions | old commit and output unavailable |

**Unreproducible historical totals:** SSE 14, translator 30, resilience 3. The
audit retained no command output or immutable tested tree IDs. Run the focused
tests on current PR heads and use current check evidence for any new verdict.

## Ledger/theme summary table

| Theme | Historical candidates | Reported ports | Reported duplicate | Reported defer | Historical issue note | Historical verdict |
|-------|-----------------------|----------------|--------------------|----------------|-----------------------|--------------------|
| sse-streaming | 48 | 4 | 14 | 30 | Notes proposed 6 GAP / 12 DUP / 30 DEFER and named citation defects #8948/#9003 | reject |
| translator | 48 | 4 | 22 | 22 | Notes named possible false DUPLICATES #2762, #628, #1193, #2001, #1264 | reject |
| combo-routing | 62 | 0 | 10 | 52 | Notes described a divergent lineage and missing summary tables | reject |
| resilience | 15 listed (14 distinct) | 1 | 2 | 11 (plus phantom #3012) | Notes named duplicate #1821, phantom #3012, and a bad test citation | reject |
| mcp-gateway | 7 | 0 | 1 | 6 | Notes named path-prefix errors and no PR path | reject |
| auth-oauth | 46 | 0 | 11 | 35 | Notes named fabricated/inverted citations and disputed taxonomy | reject |
| db-usage | 38 | 0 | 16 | 22 | Notes named a wrong #424 citation and disputed classifications | reject |
| provider-fixes | 43 | 0 | 19 | 24 | Notes named mislabeled gaps and stale scope | reject |
| **Audit-report aggregate** | **306** | **9** | **95** | **202** | **Includes themes absent from terminus ledger** | **REJECT** |

The immutable terminus ledger has six themes and mechanically sums to 285
candidates: 8 ports, 92 duplicates, and 185 defers. The immutable audit report
adds separate resilience and MCP findings and reports 306 / 9 / 95 / 202, but its
own resilience duplicate/phantom-row finding explains why that aggregate cannot
serve as valid cumulative ledger arithmetic. Recalculate from repaired tips.

## Document and arithmetic integrity

Defects found in campaign documents and arithmetic:

1. **Dead plan citation at audit time.** The review handoff cited a nonexistent
   plan. It now names the committed
   `docs/campaigns/2026-08-stability-repair-handoff.md` source.
2. **Reported missing themes at terminus.** Historical notes said the former #395
   ledger contained six themes and omitted resilience and mcp-gateway. Verify the
   current ledger through the [current PR #395 diff](https://github.com/bloodf/durindoor/pull/395/files).
3. **Reported resilience ledger corruption.** Notes described 15 rows with 14
   distinct candidates, duplicate #1821, phantom #3012, and a bad test citation.
4. **Reported combo-routing ledger divergence.** The immutable audit report
   describes a 62-row combo ledger on a stale local lineage rather than its
   inspected branch tip.
5. **Reported cumulative arithmetic contradictions.** The immutable audit report
   records literal `INS.PRE 143:`, duplicated translator tables, truncated `…`,
   and conflicting totals. Inspect those report bytes through `git show
   79fb45ccca71187202ff3347bfe2856b6b93c624:docs/campaigns/2026-08-stability-audit.md`
   and recompute current documents independently.
6. **Historical verifier instruction typo.** The immutable audit report records
   that the then-current handoff said "9 ports" but wrote `(3 + 4 + 1 = 8)`.
   Recompute the current port inventory from the repaired ledger instead.

## PR and ancestry review

The bullets below summarize historical audit-report claims whose cited old
source commits are not all retained as published immutable evidence:

- Notes described #391 SSE and #392 translator as direct from then-current main
  with unresolved review threads and source defects.
- Notes described a combo-routing through resilience/MCP lineage and a separate
  stale-v3.9.1 lineage through auth, #394, and #395.
- Notes said #394/#395 claimed ledger-only scope while carrying provider and
  format-detection test changes already handled by #389.
- Notes said #395 lacked a complete all-eight-theme cumulative record.

Recompute every statement from current immutable commit IDs, current
[#391](https://github.com/bloodf/durindoor/pull/391/files),
[#392](https://github.com/bloodf/durindoor/pull/392/files),
[#393](https://github.com/bloodf/durindoor/pull/393/files),
[#394](https://github.com/bloodf/durindoor/pull/394/files), and
[#395](https://github.com/bloodf/durindoor/pull/395/files) diffs, plus their
current check pages. Do not treat these mutable pages as historical evidence.

## Baseline and environment notes

- The immutable audit report says `tests/__baseline__/known-fails.txt` had 0
  lines and commitlint passed across eight worktrees. Command output is
  unavailable, so neither operational result is reproducible.
- The report says `security-hardening.test.js` passed 20/20 and
  `xai-oauth-service.test.js` passed 5/5 on clean origin/main with Node
  v24.19.0/npm 12.0.2. The command output is unavailable, and Node 24 is
  unsupported.
- Re-run baseline, commitlint, and both suites on current immutable tips with
  Node 20.20.2/npm 10.8.2. Preserve commands, versions, tree IDs, output, and
  exit codes before making a current evidence claim.

## Historical recommendations recorded on 2026-08-05

The historical **REJECT** produced the repair leads below. The current repaired
branches were built to address them, so this list is neither a set of current
merge blockers nor a current status report. A final reviewer must verify every
item against the final immutable branch tips, current PR diffs, unresolved review
threads, and current checks. Only that live final-tip audit can establish current
findings or a readiness verdict.

1. The audit called for rebuilding or reconciling the resilience, combo-routing,
   auth-oauth, db-usage, and provider-fixes ledgers, removing duplicate or phantom
   rows and false citations, and reconciling all eight themes.
2. The audit called for source and test repairs in the three then-ported branches:
   - #391: split the mixed #3020/#721 commit, add `registerAll.js` to the #1148
     test, and complete #721 function-call and index-guard coverage.
   - #392: scope #3018 keyword removal and move #1425 comment edits out of #422.
   - #393: add a non-401 marker test for #1821.
3. The audit called for rebasing #394 and #395, dropping redundant
   format-detection code, aligning their bodies with their diffs, and withholding
   an all-eight-theme claim until the ledger contained all eight themes.
4. The audit called for plan citations to use
   `docs/campaigns/2026-08-stability-repair-handoff.md`.
5. The audit called for reviewable PR coverage of the ledger-only MCP-gateway
   theme through the appropriate cumulative branch.

## Historical verdict note

The immutable audit report at
[`79fb45ccca71187202ff3347bfe2856b6b93c624`](https://github.com/bloodf/durindoor/commit/79fb45ccca71187202ff3347bfe2856b6b93c624)
records **REJECT**. That historical document verdict is reproducible, but its old
source/test commits and gate output are not retained as immutable evidence, and
it is not current readiness. Regenerate findings, counts, current PR diff/check
links, supported-runtime results, and verdict after final repaired pushes.
