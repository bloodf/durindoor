# Stability Port Campaign — Review Handoff

> User-stated preference: the reviewing agent should use the **GPT 5.6-sol** model
> for all review work. Model selection is controlled by the harness/environment, not
> by prompt content. If GPT 5.6-sol is not available, fall back to the most capable
> model the environment exposes and note the substitution in the review report.

## What you are reviewing

Eight-theme stability port campaign for `bloodf/durindoor` (fork of `decolua/9router`,
cross-fork source `diegosouzapw/OmniRoute`). Goal: live-verify every candidate PR from
the 6-month recency window, port only compact localized fixes with TDD, finalize
everything else with precise `DEFER` reasons, and produce a cumulative ledger.

## Read first

1. `AGENTS.md` — repository contract (binding).
2. `docs/campaigns/2026-08-stability-repair-handoff.md` — committed campaign
   repair plan, status workflow, and supported-runtime gate instructions.
3. `docs/campaigns/stability-port-2026-08-ledger.md` — cumulative campaign ledger
   (lives on every themed branch; inspect its current version through the mapped
   worktree and current PR diff).

## Branches to review

| Theme | Branch | PR |
|-------|--------|----|
| sse-streaming | `port/sse-streaming-stability` | [#391](https://github.com/bloodf/durindoor/pull/391) |
| translator | `port/translator-stability` | [#392](https://github.com/bloodf/durindoor/pull/392) |
| combo-routing | `port/combo-routing-stability` | (no PR; ledger-only) |
| resilience | `port/resilience-stability` | [#393](https://github.com/bloodf/durindoor/pull/393) |
| mcp-gateway | `port/mcp-gateway-stability` | (no PR; ledger-only) |
| auth-oauth | `port/auth-oauth-stability` | (no PR; ledger-only) |
| db-usage | `port/db-usage-stability` | [#394](https://github.com/bloodf/durindoor/pull/394) |
| provider-fixes | `port/provider-fixes-stability` | [#395](https://github.com/bloodf/durindoor/pull/395) |

Discover worktrees before branch-specific checks:

  git worktree list --porcelain

Record each `worktree`, `HEAD`, and `branch` tuple, then match it to
`gh pr view <N> -R bloodf/durindoor --json number,headRefName,headRefOid,url`.
As of 2026-08-07, examples were `/home/cortexos/.omp/wt/391-54e088a`
through `/home/cortexos/.omp/wt/396-54e088a`, with local branches `pr-391`
through `pr-396`. These paths may expire; do not use an example until the
porcelain output and PR head metadata confirm it. The three ledger-only themes
may have no worktree and require an approved isolated checkout.

## Focus per branch

1. **Source-of-truth inspection.** For each `GAP → ported` row in the ledger,
   fetch the patch, not only its file metadata. For 9router, run
   `gh pr diff 3020 -R decolua/9router`; query metadata separately with
   `gh pr view 3020 -R decolua/9router --json number,title,url,headRefOid`.
   For OmniRoute, run `gh pr diff 9457 -R diegosouzapw/OmniRoute` and
   `gh pr view 9457 -R diegosouzapw/OmniRoute --json number,title,url,headRefOid`.
   The harness equivalent is `pr://<owner>/<repo>/<N>/diff/all`. Confirm the
   cited DurinDoor file:line anchor still exists at branch HEAD.
2. **Evidence accuracy.** For each `DUPLICATE` row, confirm the cited DD file
   actually implements the behavior. Fabricated citations are a real failure mode
   (the translator #422 row was a manufactured duplicate; we caught and ported it
   during that theme's review).
3. **Deferral honesty.** For each `DEFER` row, confirm the cited reason matches the
   live PR diff. "Too large" without a specific subsystem or file scope is not
   acceptable.
4. **Ledger arithmetic.** Each theme section has its own
   `Verdict / Count / PRs` summary and a per-source split. Reconcile them against
   the row-by-row list.
5. **Test hygiene.** Each ported PR must have at least one new/changed test in
   the same commit, and the test must assert a real (not vacuous) property of the
   fixed behavior.
6. **Commit isolation.** Each `port(upstream): #N` commit must contain only that
   source PR's changes. Subject must obey commitlint's `subject-max-length: 100` and
   the body must carry the upstream PR URL.
7. **Baseline impact.** `tests/__baseline__/known-fails.txt` must remain empty
   (0 lines) on every branch.
8. **Environment attribution.** Run both disputed suites from a clean
   `origin/main` worktree with the repository-supported Node `20.20.2` and npm
   `10.8.2` before classifying them:
   `(cd tests && npx vitest run --config vitest.config.js unit/security-hardening.test.js unit/xai-oauth-service.test.js)`.
   Node 24 results from the 2026-08-05 audit are unsupported-runtime historical
   evidence only. They do not establish a supported-runtime pass or failure.

## Specific items to verify

### SSE (#391) — 4 ports
- #3020: inclusive vs exclusive cache accounting
  - `open-sse/handlers/chatCore/sseToJsonHandler.js:212-220` should use
    `canonicalizeUsage(usage)` and emit dense `output` only on the inclusive
    Responses path. Confirmed by `tests/unit/sse-to-json-cache-tokens-3020.test.js`.
  - `open-sse/transformer/streamToJsonConverter.js:69` must preserve
    `input_tokens_details.cached_tokens` (NOT rewrite to `cache_read_input_tokens`).
- #1272: omitted `stream` defaulting to false
  - `open-sse/handlers/chatCore/streamFlag.js:27` should be
    `bodyStream === true`, not `bodyStream !== false`.
  - Confirmed by `tests/unit/resolve-stream-flag.test.js`.
- #1148: drop null SSE frames
  - `open-sse/translator/index.js:254-256` same-format passthrough returns
    `chunk == null ? [] : [chunk]`.
  - `open-sse/utils/streamHelpers.js:143` returns `""` for null.
- #721: `response.completed` includes finalized `output` array
  - Both `open-sse/transformer/responsesTransformer.js:88-92` and
    `open-sse/translator/response/openai-responses.js:22-28,491-493` must record
    `response.output_item.done` items and attach deterministic dense `output`.
  - Confirmed by `tests/unit/responses-completed-output.test.js` (covers both
    paths).

### Translator (#392) — 4 ports
- #3018: 5 missing JSON Schema keywords stripped for Gemini
  - `open-sse/translator/formats/gemini.js:25` includes `uniqueItems`,
    `contains`, `unevaluatedProperties`, `unevaluatedItems`, `contentSchema`.
- #1425: Codex default effort to medium
  - `open-sse/executors/codex.js:867` default is `'medium'`.
  - Comments at lines 856 and 864 must read "medium (default)".
- #1337: Xiaomi providers echo reasoning content
  - `open-sse/utils/reasoningContentInjector.js:15` includes Xiaomi providers.
- #422: numeric schema constraint coercion across all 4 request converters
  - `open-sse/translator/formats/openai.js` exports
    `coerceSchemaNumericConstraints`.
  - `open-sse/translator/request/claude-to-openai.js:84-85,124` applies it.
  - `open-sse/translator/request/openai-responses.js:279` (`normalizeToolParameters`)
    applies it; descriptions at 224, 243, 398 use `typeof ... === "string"`.
  - Confirmed by `tests/unit/openai-schema-numeric-constraints.test.js`.

### Resilience (#393) — 1 port
- #1821: OpenAI 401 / `token_expired` is permanent
  - `open-sse/services/tokenRefresh/providers.js:301-309` returns `permanent:true`
    on HTTP 401 or marker hit.
  - Confirmed by `tests/unit/oauth-classify-token-expired.test.js`.

## Verifier prompt (use this to dispatch the reviewer)

```text
You are auditing the 2026-08 stability port campaign for the DurinDoor
bloodf/durindoor fork. The committed repair plan is at
docs/campaigns/2026-08-stability-repair-handoff.md and the per-candidate ledger
is at docs/campaigns/stability-port-2026-08-ledger.md. Read AGENTS.md first; the
repo contract is binding.

Inspect, in order:
1. Derive the exact per-theme and per-port inventory from the current ledger row
   tables and each theme and campaign summary; do not use counts in this prompt
   as the inventory authority. The repaired ledger's current cross-check is 15
   total ports, including 6 provider-fixes ports. It currently shows four
   zero-port themes: combo-routing, mcp-gateway, auth-oauth, and db-usage.
2. Inspect every port commit in that derived inventory. For every zero-port
   theme, verify the deferred reasons against the live upstream diffs rather
   than trusting summary text.
3. Reconcile the cumulative ledger arithmetic in the current
   [PR #395 diff](https://github.com/bloodf/durindoor/pull/395/files). Do not treat
   its mutable history as evidence of the bytes inspected in the old audit.
4. The known-fails baseline (must remain 0 lines on every branch).
5. The disputed environment suites on clean origin/main with Node 20.20.2/npm
   10.8.2. Do not use the historical Node 24 run as supported-runtime evidence.

For each port commit:
- Fetch the concrete upstream patch with `gh pr diff <N> -R decolua/9router` or
  `gh pr diff <N> -R diegosouzapw/OmniRoute`. Query metadata separately with
  `gh pr view <N> -R <owner>/<repo> --json number,title,url,headRefOid`. The
  harness equivalent is `pr://<owner>/<repo>/<N>/diff/all`.
- Read the cited DD file:line and confirm it exists at the branch HEAD.
- Read the cited test and confirm it asserts a real property of the fix.
- From the relevant worktree root, run the concrete test path inside the tests
  package. Example: `(cd tests && npx vitest run --config vitest.config.js
  unit/sse-to-json-cache-tokens-3020.test.js)`.
For each ledger row:
- DUPLICATE: confirm the cited file/symbol/line range still implements the
  behavior. Fabricated citations are a Critical finding.
- DEFER: confirm the reason is specific and matches the live PR diff. Generic
  reasons (multi-file refactor / too large) without subsystem names are a Minor
  finding worth flagging.
- GAP → ported: confirm the commit SHA in the Evidence column exists and matches
  a port commit on the branch.

Return a structured audit report:

```yaml
auditSummary:
  portsReviewed: N
  duplicatesSpotChecked: N
  defersSpotChecked: N
  ledgersValidated: [branches]
  knownFailsBaseline: { lines: 0, expected: 0 }
  preExistingEnvFailuresReproduced: [paths]

findings:
  - severity: Critical | Important | Minor
    theme: <name>
    pr: #<N>
    location: <file:line>
    issue: <concrete description with evidence>
    recommendation: <concrete fix>

concerns: [anything the maintainer should know but isn't a finding]

cleanOriginAttribution:
  - { path: tests/unit/security-hardening.test.js, status: pre-existing, evidence: "reproduced on origin/main" }
  - { path: tests/unit/xai-oauth-service.test.js, status: pre-existing, evidence: "reproduced on origin/main" }

verdict: APPROVED | CHANGES_REQUESTED | REJECT
```

If a finding is Critical or Important, do not fix it yourself. Report it; the user
decides. Do not run formatter, lint, or project-wide build. Do not run
real-provider tests.
```

## Known hazards (from prior campaign incidents)

- **Sonic agent wrote to the wrong branch.** Once (db-usage), the ledger-only
  commit landed on the user's dirty primary checkout (`tracking/main`) instead of
  the dedicated worktree. Preserve the user tip, restore it with the repository's
  approved non-destructive recovery procedure, and apply the campaign commit to
  the intended worktree. Verify paths with `git worktree list` before mutation.
- **Scout corrupted a worktree file.** During db-usage triage, a scout ran
  `git checkout` of `open-sse/services/usage/codex.js` inside a worktree, overwriting
  the file with the primary-checkout's dirty 10-line truncated version. The
  worktree had the correct 299-line version; the primary had the truncated one.
  From the affected worktree root, use
  `git restore --source=HEAD -- open-sse/services/usage/codex.js`; never copy a
  tracked file between worktrees.
- **Provider stream attribution.** The 2026-08-05 audit ran
  `tests/unit/security-hardening.test.js` and
  `tests/unit/xai-oauth-service.test.js` only with Node 24. Treat those results as
  unsupported-runtime history. Re-run both with Node 20.20.2/npm 10.8.2 before
  calling either result pre-existing or campaign-caused.

## Report format

The reviewer should produce one consolidated audit report (not per-theme). Save it
to `docs/campaigns/2026-08-stability-audit.md` and open a PR against
`port/provider-fixes-stability` (the campaign-terminus branch). The report should
include:

- A summary block of the YAML above.
- Per-port verification (commit SHA, test evidence, file:line anchor).
- Per-ledger-section evidence spot-checks (3-5 random rows per theme).
- The two pre-existing failures, explicitly attributed to the environment.
- A "Recommendations" section if the verdict is CHANGES_REQUESTED or REJECT.

If the verdict is APPROVED, the user merges the themed PRs in order. The
campaign does not merge its own work.
