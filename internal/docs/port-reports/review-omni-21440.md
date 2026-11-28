# OmniRoute PR 21440 Anthropic credit and quota cooldown review

Upstream: [cheaper-inference/OmniRoute PR 21440](https://github.com/cheaper-inference/OmniRoute/pull/21440), "fix(resilience): pause connections on Anthropic 400 usage-limit/credit and free-quota 403 responses". Head `115338ff9f3f6ddd547fa0948b6d1a114114f0ef`, confirmed by an unauthenticated `git ls-remote` of `refs/pull/21440/head` and by fetching that commit into a scratch repository. Public metadata at review time: open, not merged, base `release/v3.8.55` (`b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523`), 5 files, +279/-15, body states it closes OmniRoute #21250. The PR diff is taken against that base and matches the reported counts.

DurinDoor main: `29490b783e83176d4d6a4162f76ee3dc79db66ea`. Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c`. The worktree HEAD (`e4eb85eefd`) was not used as a comparison base.

## Disposition

Do not port this PR as-is, and treat it as a set of separate candidate behaviors, not one unit. Three of its claims are partly or fully present already on main. Two source-visible gaps remain, both conditional on the upstream wire text being real. No product code, tests, or frozen-train files were changed, and this review makes no implementation claim.

Auth owns the implementation decision. The gap ranking below is for that lane's scoping.

## What the PR changes (OmniRoute, TypeScript)

| File (OmniRoute) | Change |
|---|---|
| `open-sse/services/accountFallback.ts` | In the `isCreditsExhaustedForStatus` branch, takes `cooldownMs` from a parsed ISO reset date (`body_iso_reset`) instead of the flat 1h `paymentRequired` cooldown. |
| `open-sse/services/accountFallback/anthropicAccountCredit.ts` | Adds the phrase `you have reached your specified api usage limits`; strips any `[NNN]: ` prefix; adds `claude` to `isAnthropicCreditProvider`. |
| `open-sse/services/accountFallback/creditExhaustionSignals.ts` | Adds signals `free quota has been exhausted` (403) and `you have reached your specified api usage limits`. |
| `open-sse/services/quotaResetParsing.ts` | Accepts `regain access on YYYY-MM-DD at HH:MM UTC`. |
| `tests/unit/credit-and-free-quota-400-403-21250.test.ts` | New. Imports OmniRoute-only modules (`src/lib/db/core.ts`, `creditsExhaustedForStatus.ts`, `errorClassifier.ts`, `authTerminalStatus.ts`) and asserts fields (`creditsExhausted`, `retryHintSource`, `quotaResetHintMs`, `classifyProviderError`) that have no DurinDoor counterpart. Not run, and it cannot run here as written. |

The PR's own claims do not depend on DurinDoor's config. The behaviors are compared below by concept.

## Findings

Severity is the review's judgment for the Auth lane. Confidence reflects whether the claim rests on source, on an offline probe, or on the PR text alone.

1. **Anthropic API usage-limit HTTP 400 gets no account penalty on main.** Severity: medium, conditional on wire text. Confidence: source and probe confirmed; wire text unverified.
   - Main has no usage-limit phrase. `open-sse/services/anthropicAccountCredit.js:7` defines only `CREDIT_PHRASE = "your credit balance is too low"`. The 400 credit branch at `open-sse/services/accountFallback.js:243-246` checks only that phrase.
   - The classifier returns `requestScoped: true` with `shouldFallback: false` for both prefixed and envelope forms (probe rows below).
   - `detectQuotaExhaustion` (`open-sse/services/accountFallback.js:663`) does not match the usage-limit text either (probe: `exhausted: false`). The request-scoped early return at `src/sse/services/auth/accountErrors.js:405` covers only 404 and OpenRouter 400, so this path continues and returns at line 458 (`if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 }`), with no lock written.
   - Consequence if the wire text is real: an exhausted spend cap on one Anthropic key is not benched, so the same key is re-selected for each request while combos move past it per request.
   - Missing reset-date handling is secondary here (see finding 4).

2. **`claude` credit 400 is not connection-wide on main.** Severity: low-medium, conditional on the `claude` OAuth connection receiving the credit envelope. Confidence: source and probe confirmed.
   - DurinDoor's provider id `claude` (`open-sse/providers/registry/claude.js`, `category: "oauth"`, `display.deprecated: true`) is distinct from `anthropic`. `isAnthropicCreditProvider("claude")` returns `false` (`open-sse/services/anthropicAccountCredit.js:10-13`).
   - The text rule `{ text: "credit balance is too low", cooldownMs: COOLDOWN.long, terminal: true }` (`open-sse/config/errorConfig.js:283`) still applies to `claude`, so the 120 s terminal cooldown is set. Only `scope` differs (probe: `connection` for `anthropic`, `null` for `claude`).
   - `src/sse/services/auth/accountErrors.js:504-506` makes the lock account-wide only when `fallbackResult.scope === "connection"` (or caller evidence says so for `claude`). Otherwise `resolveFallbackModelScope` (`open-sse/services/fallbackScope.js:25-33`) returns a model-scoped key, so other models on that connection stay routable for the 120 s window.
   - This is the one place the PR's `claude` inclusion changes behavior. Whether `claude` OAuth ever returns this envelope is not verified.

3. **Free-quota 403 is partly covered on main.** Severity: low. Confidence: source and probe confirmed; the upstream body shape is unverified.
   - On main every 403 gets the generic `{ status: 403, cooldownMs: COOLDOWN.long }` rule (`open-sse/config/errorConfig.js:302`), so the free-quota 403 gets 120 s, the same as a permission 403 (probe row "plain 403 permission").
   - But `detectQuotaExhaustion` already matches `The free quota has been exhausted...` when the body is JSON or bare text (probe: `exhausted: true`). In `src/sse/services/auth/accountErrors.js:368` that runs before the classifier and sets a `quotaLockout` with no reset (`isQuotaLockoutActive` treats a null `reactivateAt` as active; `open-sse/services/accountFallback.js:655-661`). That is stronger than the PR's 1h cooldown.
   - The gap is narrow: only the `[403]:`-prefixed text form (the PR fixture's form) falls to the 120 s generic cooldown. Whether production reaches that form depends on whether `errorBody` is a parsed object at call sites (`src/sse/handlers/chat/singleModel/postProcess.js:186` passes `resultErrorBody` only when it is an object).

4. **Regain-access reset-date parsing is absent on main.** Severity: low, as an absent optional feature. Confidence: source confirmed.
   - `parseIsoDateTimeResetMs` and `quotaResetParsing.js` do not exist on main or the train. The reset date in the usage-limit body is therefore never read.
   - This is an absent feature, not a defect on its own. It only matters once finding 1 is addressed.

5. **Status-prefix stripping is narrower on main, with no observable defect.** Main strips only `[400]: ` (`open-sse/services/anthropicAccountCredit.js:17`). The PR generalizes to `[NNN]: `. Current credit phrasing works with either.

6. **Free-quota 403 classification on main is already covered for the JSON/bare case.** Not a gap. See finding 3.

## Upstream test status

Not executed. The PR test cannot run against DurinDoor: it imports OmniRoute modules that do not exist here and asserts fields that main does not produce. The PR's own validation section (Windows, Node v24.20.0) was not reproduced. No upstream test results are claimed.

## Source evidence on main (`29490b78`, identical on the train for every file below)

- `open-sse/services/anthropicAccountCredit.js:1-3,7,10-13,15` (OmniRoute #21076 port; credit phrase only; `claude` not a credit provider)
- `open-sse/services/accountFallback.js:113,117` (DashScope unpaid codes and rule; the free-quota 403 text is not covered), `170` (`checkFallbackError` signature with provider as 4th positional argument), `243-246` (Anthropic credit 400 branch), `400` (generic classification), `496` (`checkFallbackErrorByRules`), `663` (`detectQuotaExhaustion`)
- `open-sse/config/errorConfig.js:283` (credit text rule, terminal, 120 s), `301-302` (402 terminal, generic 403 at 120 s)
- `open-sse/services/fallbackScope.js:23,25` (`CLIENT_REQUEST_FALLBACK_SCOPE`, `resolveFallbackModelScope`)
- `open-sse/providers/registry/claude.js` (`id: "claude"`, oauth, deprecated)
- `src/sse/services/auth/accountErrors.js:221` (`markAccountUnavailable`), `368` (quota detection), `393` (`checkFallbackError` call), `405` (early return for request-scoped/no-penalty), `458` (`!shouldFallback` early return), `504-506` (connection-wide scope decision)
- `src/sse/handlers/chat/singleModel/postProcess.js:186` (`errorBody: resultErrorBody`)
- Not present on main or train: `parseIsoDateTimeResetMs`, `you have reached your specified api usage limits`, `free quota has been exhausted`.

## Offline probe (source only, no dependency install)

Method: `git archive` of main's `open-sse` and `src` trees was extracted to `/var/tmp/durin-main-21440`. The classifier was imported directly from that copy. Run with `env -i PATH=/usr/bin:/bin HOME=/var/tmp/home21440 DATA_DIR=/var/tmp/data21440 TMPDIR=/var/tmp/tmp21440`, Node v24.22.3, under a 300-second ceiling. No credentials, no `~/.9router`, no provider calls. Probe scripts: `/var/tmp/durin-probe-21440/probe4.mjs` and `probe3.mjs`.

An earlier probe passed the model id in the 4th positional slot, where `provider` belongs (`open-sse/services/accountFallback.js:170`), so provider-specific rules were not exercised. Those results were discarded. All results below use the object form of `checkFallbackError`.

| Case | shouldFallback | cooldownMs | scope | terminal | requestScoped |
|---|---|---|---|---|---|
| credit 400 JSON, `anthropic` | true | 120000 | connection | true | false |
| credit 400 JSON, `claude` | true | 120000 | null | true | false |
| credit 400 JSON, `anthropic-compatible-x` | true | 120000 | connection | true | false |
| usage-limit 400 JSON, `anthropic` | false | 0 | null | false | true |
| usage-limit 400 JSON, `claude` | false | 0 | null | false | true |
| usage-limit 400 `[400]:`-prefixed, `anthropic` | false | 0 | null | false | true |
| free-quota 403 `[403]:`-prefixed, `qwen` | true | 120000 | null | false | false |
| free-quota 403 JSON, `qwen` | true | 120000 | null | false | false |
| plain 403 permission, `openai` | true | 120000 | null | false | false |

`detectQuotaExhaustion` (`exhausted`, `resetAtMs`):
- free-quota 403 JSON: `true`, `null`
- free-quota 403 bare: `true`, `null`
- free-quota 403 `[403]:`-prefixed: `false`
- usage-limit 400 JSON, bare, and `[400]:`-prefixed: `false`

`isAnthropicCreditProvider("claude")`: `false`. `isAnthropicAccountCreditExhausted("[400]: <credit>")`: `true`. `isAnthropicAccountCreditExhausted("[400]: <usage-limit>")`: `false`.

Not executed: the full `markAccountUnavailable` path. It requires the local DB module (`@/lib/localDb`) and a fresh data directory. The lock outcomes in findings 1 and 2 are inferred from `accountErrors.js:458-506` and `fallbackScope.js`, not observed as persisted rows.

## Uncertainties

- **Wire text is unverified.** The usage-limit and free-quota phrases come from the PR body and fixtures. Neither phrase appears in main, the train, or any local fixture, and no live provider was called. Finding 1 holds only if Anthropic's API actually returns that text on a 400.
- **`claude` OAuth reachability.** Whether the `claude` connection can receive Anthropic's credit envelope is unverified (finding 2).
- **Unknown-model lock for `claude`.** If `resolveFallbackModelScope` returns `null` for an unrecognized model id, the persisted lock scope was not checked. The model-scoped result in finding 2 assumes a catalog id.
- **Body shape at call sites.** Finding 3 depends on whether `errorBody` arrives as a parsed object for 403s. Only the `postProcess.js` path was read.
- **Indefinite quota lockout (observation, not a defect claim).** `isQuotaLockoutActive` treats a null `reactivateAt` as active, so a JSON free-quota 403 on main can persist until cleared. The PR's 1h cooldown would not apply to that path. Auth should decide which behavior is intended.

## Suggested scope for the Auth lane (no implementation claimed here)

If Auth takes any of this, the smallest source-verified items are finding 1 (phrase plus scope decision, after confirming the wire text) and finding 2 (add `claude` to the connection-wide scope check, after confirming the wire). DurinDoor's tests use Vitest under `tests/unit/`, so the PR's `node:test` harness would need to be re-expressed. Findings 3 to 5 are low priority. Nothing here requires touching the frozen train.

## Reviewed and not changed

- No product code, tests, docs (other than this report), dependencies, or frozen-train files were changed.
- No PR, issue, link, watch, listing, push, or merge action was taken. Two unauthenticated reads were made against the public GitHub API and git remote: PR metadata, and the PR head commit fetched into scratch repositories under `/var/tmp`.
- No dependencies were installed, no tests were run, and no provider or secret was used.
- `~/.9router` was not accessed.
