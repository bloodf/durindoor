# Stability Port Campaign — Consolidated Audit Report

**Date:** 2026-08-05  
**Target:** 8-theme stability port campaign for `bloodf/durindoor` (fork of `decolua/9router`, cross-fork source `diegosouzapw/OmniRoute`)  
**Audit worktree:** `.omc/wt-stability-campaign-audit` (`docs/stability-campaign-audit`)  
**Campaign terminus:** `port/provider-fixes-stability` @ `e03a8d610`  
**Model disclosure:** Parent synthesis ran on `durindoor/cx/gpt-5.6-sol`. Delegated reviewer subagents were frequently routed to `durindoor/cc/claude-opus-4-8` by the task harness; the substitution is noted in this report as required by the review handoff.

```yaml
auditSummary:
  portsReviewed: 9
  duplicatesSpotChecked: 95
  defersSpotChecked: 202
  ledgersValidated:
    - port/sse-streaming-stability
    - port/translator-stability
    - port/resilience-stability
    - port/combo-routing-stability (ledger-only; divergent lineage)
    - port/mcp-gateway-stability (ledger-only; no PR path)
    - port/auth-oauth-stability (ledger-only)
    - port/db-usage-stability (#394 stack)
    - port/provider-fixes-stability (#395 stack)
  knownFailsBaseline: { lines: 0, expected: 0 }
  preExistingEnvFailuresReproduced: []

findings:
  - severity: Critical
    theme: campaign-documents
    pr: "n/a"
    location: "docs/campaigns/2026-08-stability-handoff.md"
    issue: >
      The review handoff and verifier prompt cite an authoritative plan at
      docs/campaigns/2026-08-stability-handoff.md, but the file does not exist in
      any checkout, worktree, or git history. Only the review handoff
      (docs/campaigns/2026-08-stability-review-handoff.md) is present. The
      campaign therefore lacks a discoverable authoritative plan, and the
      verifier instructions reference a dead document.
    recommendation: >
      Create the missing plan or retitle all references to the review handoff;
      ensure every future campaign has one authoritative document that matches
      the file name used in instructions and PR bodies.

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
    location: "port/combo-routing-stability branch HEAD 01f0f351b vs. ledger"
    issue: >
      The combo-routing ledger section with 62 rows exists only on the divergent
      91a787cd lineage, not on the branch HEAD (01f0f351b) that the campaign
      claims as the combo worktree tip. The HEAD ledger contains only SSE and
      translator themes. Combo therefore has no verifiable ledger at the stated
      campaign terminus, and its arithmetic (10 duplicate / 52 defer) cannot be
      validated against the actual branch.
    recommendation: >
      Reconcile the combo-routing lineage: either 91a787cd is the real combo tip
      and 01f0f351b is stale, or the 62-row ledger must be replayed onto the
      current branch. Do not report a combo count without a ledger on the branch
      HEAD.

  - severity: Critical
    theme: mcp-gateway
    pr: "ledger-only"
    location: "port/mcp-gateway-stability"
    issue: >
      MCP-gateway has no PR and no merge path. The terminus branch
      (port/provider-fixes-stability) and the audit worktree ledger contain only
      six themes, omitting both resilience and mcp-gateway despite #395 claiming
      a cumulative record for all eight themes.
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
      tests/translator/format-detection.test.js from e691fc2e1, a stale-v3.9.1
      format-detection port. The current main already handles anthropic-version
      via #389, making the inherited code redundant or divergent. The PR body is
      therefore inaccurate and the branch is not ledger-only.
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
    location: "port/sse-streaming-stability e2403e298"
    issue: >
      The follow-up commit e2403e298 normalizes inclusive/exclusive cache usage
      but mixes #3020 source changes with #721 test edits and omits the
      upstream PR URL from the commit body, violating commit-isolation rules.
    recommendation: >
      Split the mixed commit into a #3020-only change and a #721-only test
      commit, each with the correct upstream URL in the body.

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
    pr: "#392 / #422"
    location: "port/translator-stability 43eb1a869"
    issue: >
      The #422 commit edits Codex comments that belong to #1425 (lines 856 and
      864), violating commit isolation. The coercion itself reaches all four
      converter routes correctly, but the commit is not single-purpose.
    recommendation: >
      Move the #1425 comment changes into the #1425 commit and keep #422 limited
      to numeric-constraint coercion.

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
    The PR #395 terminus claims to be the cumulative record for all 8 themes,
    but the ledger at e03a8d610 contains only SSE, translator, combo-routing,
    auth-oauth, db-usage, and provider-fixes. Resilience and mcp-gateway are
    absent. This is not a counting discrepancy; it is a missing-theme defect.
  - >
    Two separate branch lineages exist: Lineage A (combo 01f0f351b → #1821 →
    resilience e62ff5146 → MCP 99689895b) and Lineage B from stale v3.9.1 base
    e01f542 (format-detection e691fc2e1 → combo 91a787cd → auth 60b1135f4 → DB
    ea4c803b9 → provider e03a8d610). Lineage B is behind current main by two
    commits. #394 and #395 sit on Lineage B and carry redundant/divergent code.
  - >
    The handoff instructs reviewers to treat
    docs/campaigns/2026-08-stability-handoff.md as the authoritative plan, but
    that file is absent. This report uses the review handoff
    (docs/campaigns/2026-08-stability-review-handoff.md) as the closest available
    source of record and notes the dead citation explicitly.
  - >
    All 8 campaign worktrees keep tests/__baseline__/known-fails.txt at 0
    lines/0 bytes, and commitlint passed on the appropriate ranges for each
    branch. These baseline checks are clean, but they do not compensate for the
    ledger and source defects above.

cleanOriginAttribution:
  - path: tests/unit/security-hardening.test.js
    status: not-reproduced-as-pre-existing
    evidence: >
      Run on a clean origin/main worktree at ee1eddf1 with Node
      v24.19.0/npm 12.0.2: all 20/20 tests passed. The handoff's claim of a
      native better-sqlite3 ABI mismatch did not reproduce in this environment.
  - path: tests/unit/xai-oauth-service.test.js
    status: not-reproduced-as-pre-existing
    evidence: >
      Run on a clean origin/main worktree at ee1eddf1 with Node
      v24.19.0/npm 12.0.2: all 5/5 tests passed. The handoff's claim of a Node
      24 fetch/PKCE timeout did not reproduce in this environment.

verdict: REJECT
```

## Scope and method

This audit reviewed the 8-theme stability port campaign from evidence gathered
by independent theme, port, PR, arithmetic, and ancestry reviewers. The parent
orchestrator independently ran the focused tests, origin checks, and commitlint
gates reported below; the report-writing subagent did not rerun them.

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

Spot-check method: for every port commit, the evidence bundle contains the
upstream PR diff, the cited DD file:line anchor, the test assertion, and the
focused vitest result. For ledger-only themes, every row was inspected for
source-backed evidence; fabricated or inverted citations are flagged as findings.

## Port verification table

| Theme | Upstream PR | DD commit | Cited file:line anchor | Test file | Tests | Result |
|-------|-------------|-----------|------------------------|-----------|-------|--------|
| sse-streaming | #3020 | a3803e100 (initial), e2403e298 (follow-up) | `open-sse/handlers/chatCore/sseToJsonHandler.js:212-220` | `tests/unit/sse-to-json-cache-tokens-3020.test.js` | 14 total | pass |
| sse-streaming | #1272 | dcc871ee9 | `open-sse/handlers/chatCore/streamFlag.js:27` | `tests/unit/resolve-stream-flag.test.js` | 14 total | pass |
| sse-streaming | #1148 | 6f966d887 | `open-sse/translator/index.js:254-256`, `open-sse/utils/streamHelpers.js:143` | `tests/unit/sse-null-frame.test.js` | 14 total | pass (but missing `registerAll.js` import) |
| sse-streaming | #721 | f99ceb044 | `open-sse/transformer/responsesTransformer.js:88-92`, `open-sse/translator/response/openai-responses.js:22-28,491-493` | `tests/unit/responses-completed-output.test.js` | 14 total | pass (but incomplete coverage) |
| translator | #3018 | 703d98d9c | `open-sse/translator/formats/gemini.js:25` | `tests/unit/gemini-schema-multiple-of.test.js` | 30 total | pass |
| translator | #1425 | 3694d3ebb | `open-sse/executors/codex.js:867` | `tests/unit/codex-effort-wire.test.js` | 30 total | pass |
| translator | #1337 | 0c180f182 | `open-sse/utils/reasoningContentInjector.js:15` | `tests/unit/reasoningContentInjector.test.js` | 30 total | pass |
| translator | #422 | 43eb1a869 | `open-sse/translator/formats/openai.js`, `open-sse/translator/request/claude-to-openai.js:84-85,124`, `open-sse/translator/request/openai-responses.js:279` | `tests/unit/openai-schema-numeric-constraints.test.js` | 30 total | pass (but commit edits #1425 comments) |
| resilience | #1821 | 4fa1153e9 | `open-sse/services/tokenRefresh/providers.js:301-309` | `tests/unit/oauth-classify-token-expired.test.js` | 3 | pass (but marker assertions both use 401) |

**Focused test totals:**
- SSE: 4 files, 14 tests passed.
- Translator: 4 files, 30 tests passed.
- Resilience: 1 file, 3 tests passed.
- All commitlint ranges passed on the audited branches.

## Ledger/theme summary table

| Theme | Candidates | As-written ports | As-written duplicate | As-written defer | Source-backed issues | Verdict |
|-------|------------|------------------|----------------------|------------------|----------------------|---------|
| sse-streaming | 48 | 4 | 14 | 30 | Conservative corrected 6 GAP / 12 DUP / 30 DEFER; citation defects #8948/#9003; count drift 49→52 | reject |
| translator | 48 | 4 | 22 | 22 | 4/22/22 arithmetic passes but multiple false DUPLICATES (#2762, #628, #1193, #2001, #1264) | reject |
| combo-routing | 62 | 0 | 10 | 52 | Ledger section only on divergent 91a787cd; missing from branch HEAD 01f0f351b; missing summary tables | reject |
| resilience | 15 listed (14 distinct) | 1 | 2 | 11 (plus phantom #3012) | Duplicate #1821; phantom #3012; nonexistent test citation | reject |
| mcp-gateway | 7 | 0 | 1 | 6 | Minor path-prefix errors; no PR path | reject |
| auth-oauth | 46 | 0 | 11 | 35 | Many fabricated/inverted citations; reviewers disagreed on partial-bundle taxonomy | reject |
| db-usage | 38 | 0 | 16 | 22 | #424 cites the wrong table; #2811 is a compact GAP; several DEFER rows are already DUPLICATE | reject |
| provider-fixes | 43 | 0 | 19 | 24 | High-confidence GAPs mislabeled DEFER; fabricated/stale scope (#3023 etc.) | reject |
| **Total** | **306** | **9** | **95** | **202** | **Cumulative arithmetic is not trustworthy** | **REJECT** |

The as-written campaign totals (9 port / 95 duplicate / 202 defer = 306) are
arithmetically consistent with the per-theme as-written counts, but the
source-backed semantic totals differ because of the misclassified rows listed
above. This report therefore does **not** endorse the 9/95/202 totals as
audited fact; it reports the as-written counts with their known defects.

## Document and arithmetic integrity

Defects found in campaign documents and arithmetic:

1. **Missing authoritative plan.** `docs/campaigns/2026-08-stability-handoff.md` is
   cited as the authoritative plan but does not exist in git. Only the review
   handoff (`docs/campaigns/2026-08-stability-review-handoff.md`) is present.
2. **Missing themes at terminus.** The terminus ledger at `e03a8d610` contains
   only six themes; resilience and mcp-gateway are absent despite #395 claiming a
   cumulative record for all eight.
3. **Resilience ledger corruption.** 15 rows list only 14 distinct candidates;
   #1821 is duplicated, #3012 is a phantom summary-only reference, and the cited
   test file does not exist.
4. **Combo-routing ledger divergence.** The 62-row combo ledger exists on the
   stale Lineage B (`91a787cd`), not on the stated branch HEAD (`01f0f351b`).
5. **Cumulative arithmetic contradictions.** Early resilience / MCP / auth
   ledgers contain literal `INS.PRE 143:`, duplicated translator tables,
   truncated `…`, and self-contradictory cumulative totals (172/143 versus source
   split 61/32). No valid cumulative arithmetic exists at the terminus.
6. **Verifier instruction typo.** The handoff verifier says "9 ports" but writes
   `(3 + 4 + 1 = 8)`; the correct decomposition is 4 SSE + 4 translator + 1
   resilience = 9 ports across 3 of the 8 branches.

## PR and ancestry review

- **#391 SSE** and **#392 translator** are direct from current main and are blocked
  on approval/review because of unresolved valid bot P2 threads and the source
  defects listed above.
- **Lineage A:** `01f0f351b` (combo) → #1821 → `e62ff5146` (resilience) →
  `99689895b` (MCP). MCP has no PR path and auth initially pointed to the same
  MCP tip with no auth-specific delta.
- **Lineage B:** from stale v3.9.1 base `e01f542` → `e691fc2e1` (format-detection
  port) → `91a787cd` (combo) → `60b1135f4` (auth) → `ea4c803b9` (DB #394) →
  `e03a8d610` (provider #395). This branch is behind current main by two commits.
- **#394 / #395** PR bodies state zero-port / ledger-only / no tests, but their diffs
  contain `open-sse/services/provider.js` and
  `tests/translator/format-detection.test.js` inherited from `e691fc2e1`. Because
  current main already handles `anthropic-version` via #389, this inherited code
  is redundant or divergent and should be dropped on rebase.
- **#395** must not merge until its claim of an all-eight-theme cumulative record
  is true or corrected.

## Baseline and environment results

- `tests/__baseline__/known-fails.txt` was verified at 0 lines / 0 bytes on all
  eight campaign worktrees. No campaign commit modifies the baseline.
- Commitlint passed on the appropriate `origin/main..HEAD` range for each branch.
- The two handoff-listed pre-existing environment failures were **not reproduced**
  in the audit environment:
  - `tests/unit/security-hardening.test.js`: 20/20 passed on clean `origin/main`
    at `ee1eddf1` with Node v24.19.0 / npm 12.0.2.
  - `tests/unit/xai-oauth-service.test.js`: 5/5 passed on the same clean
    `origin/main` worktree.
- The handoff attributes these failures to native `better-sqlite3` ABI mismatch
  and Node 24 fetch/PKCE timeout; those failures did not occur in this
  environment. They are therefore reported as **not reproduced** rather than as
  confirmed pre-existing campaign regressions.

## Recommendations (prioritized)

Because the verdict is **REJECT**, the campaign should not merge any themed PR
until the following are addressed:

1. **Rebuild or reconcile the ledgers.** Start with resilience, combo-routing,
   auth-oauth, db-usage, and provider-fixes. Remove duplicate/phantom rows,
   correct fabricated citations, and reconcile the terminus so it contains all
   eight themes or stops claiming it does.
2. **Fix the source defects in the three ported PR branches.**
   - #391: split the mixed #3020/#721 commit, add `registerAll.js` to the #1148
     test, complete #721 coverage for function calls and index guards.
   - #392: scope #3018 keyword removal, move #1425 comment edits out of #422.
   - #393: add a non-401 marker test for #1821.
3. **Rebase #394 and #395 on current main.** Drop the redundant
   format-detection code from `e691fc2e1` and rewrite the PR bodies to match the
   real diffs. Ensure #395 does not claim an all-eight-theme ledger until it
   contains one.
4. **Create the missing authoritative plan or fix every citation.** Either
   write `docs/campaigns/2026-08-stability-handoff.md` or retitle all references
   to the review handoff.
5. **Do not merge MCP-gateway without a PR.** If the theme is truly
   ledger-only, open a PR against the appropriate base so it can be reviewed.

## Final verdict

**REJECT.** The campaign has 9 upstream ports that pass their focused tests, but
the surrounding documentation is incomplete and in several places corrupt. The
three ported PRs (#391, #392, #393) contain unresolved Important behavior bugs
and test gaps; the cumulative ledger omits two themes and misclassifies rows
across multiple themes; #394 and #395 misstate their scope; and the authoritative
plan citation is dead. The campaign should not be merged as-is.
