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
2. `docs/campaigns/2026-08-stability-handoff.md` — campaign handoff with status
   snapshot, theme inventory, recipes, and pre-existing failure inventory.
3. `docs/campaigns/stability-port-2026-08-ledger.md` — cumulative campaign ledger
   (lives on every themed branch; the final version is on
   `port/provider-fixes-stability`).

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

Worktrees (already created on disk):
- `~/.omc/wt-sse-streaming-stability`
- `~/.omc/wt-translator-stability`
- `~/.omc/wt-combo-routing-stability`
- `~/.omc/wt-resilience-stability`
- `~/.omc/wt-mcp-gateway-stability`
- `~/.omc/wt-auth-oauth-stability`
- `~/.omc/wt-db-usage-stability`
- `~/.omc/wt-provider-fixes-stability`

## Focus per branch

1. **Source-of-truth inspection.** For each `GAP → ported` row in the ledger, open
   the upstream PR (`pr://decolua/9router/<N>/diff/all` or
   `pr://diegosouzapw/OmniRoute/<N>/diff/all` or `gh pr view --json files -R <owner>/<repo> <N>`).
   Confirm the cited DD file:line anchor still exists at the current branch HEAD.
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
8. **Pre-existing environment failures.** Two failures reproduce on a clean
   `origin/main` worktree and are NOT this campaign's responsibility:
   - `tests/unit/security-hardening.test.js` (wiring — 2 cases) — native
     `better-sqlite3` ABI mismatch on Node 20+.
   - `tests/unit/xai-oauth-service.test.js` (PKCE — 2 cases) — Node 24 fetch/PKCE
     timeout.
   Do not ask for these to be fixed inside the campaign.

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
bloodf/durindoor fork. The campaign's authoritative plan is at
docs/campaigns/2026-08-stability-handoff.md and the per-candidate ledger is at
docs/campaigns/stability-port-2026-08-ledger.md. Read AGENTS.md first; the
repo contract is binding.

Inspect, in order:
1. The 9 port commits on branches port/sse-streaming-stability,
   port/translator-stability, port/resilience-stability (3 + 4 + 1 = 8 branches
   worth of worktrees, plus the cumulative ledger on every themed branch).
2. The 5 zero-port ledger-only themes: combo-routing, mcp-gateway, auth-oauth,
   db-usage, provider-fixes. Verify the deferred reasons match the live upstream
   diffs (do not trust summary text).
3. The cumulative ledger arithmetic at the campaign terminus
   (port/provider-fixes-stability, commit e03a8d610).
4. The known-fails baseline (must remain 0 lines on every branch).
5. The two pre-existing environment failures (security-hardening, xai-oauth) —
   reproduce on origin/main and are NOT this campaign's bugs.

For each port commit:
- Fetch the upstream PR via pr://decolua/9router/<N>/diff/all (or OmniRoute
  equivalent) and confirm the local code change matches.
- Read the cited DD file:line and confirm it exists at the branch HEAD.
- Read the cited test and confirm it asserts a real property of the fix.
- Run the test file via `npx vitest run --config tests/vitest.config.js
  tests/unit/<name>` from the relevant worktree.

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
  the dedicated worktree. Recover by `git reset --hard <user-tip>` on the primary
  and cherry-pick the commit to the worktree. Verify the worktree path with
  `git worktree list` before any state-changing action.
- **Scout corrupted a worktree file.** During db-usage triage, a scout ran
  `git checkout` of `open-sse/services/usage/codex.js` inside a worktree, overwriting
  the file with the primary-checkout's dirty 10-line truncated version. The
  worktree had the correct 299-line version; the primary had the truncated one.
  Recover by restoring from `git show HEAD:open-sse/services/usage/codex.js` (or
  `git restore` from the worktree's HEAD) — never `git checkout` a tracked file
  into or out of a worktree.
- **Provider stream failures.** Pre-existing `tests/unit/security-hardening.test.js`
  (native better-sqlite3 ABI) and `tests/unit/xai-oauth-service.test.js` (Node 24
  PKCE timeout) reproduce on a clean `origin/main` worktree. Do not report these
  as campaign regressions; attribute them to the environment.

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
