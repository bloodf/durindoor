# Anthropic credit and usage-limit cooldown (#2034)

Port in part of [OmniRoute PR #21440](https://github.com/cheaper-inference/OmniRoute/pull/21440), pinned at head [`115338ff9f3f6ddd547fa0948b6d1a114114f0ef`](https://github.com/cheaper-inference/OmniRoute/tree/115338ff9f3f6ddd547fa0948b6d1a114114f0ef) (OmniRoute, MIT). The PR was **open** when this was written, so the behavior below is a DurinDoor choice backed by the PR's diff and fixtures, not by a released upstream. No live Anthropic or DashScope account was called.

## Upstream scope (5 files, base `b15b2ee`)

| Upstream file | Change | DurinDoor decision |
| --- | --- | --- |
| `open-sse/services/accountFallback/anthropicAccountCredit.ts` | Second leading phrase (`you have reached your specified api usage limits`), `[NNN]: ` prefix, `claude` identity, case-insensitive provider id | Ported into [`anthropicAccountCredit.js`](../../open-sse/services/anthropicAccountCredit.js). The local prefix stays `[400]: ` only, and the local check still requires the root `type: "error"`, which is stricter than upstream. |
| `open-sse/services/accountFallback.ts` | Credit result uses a parsed ISO reset as cooldown, with `retryHintSource: "body_iso_reset"` | Ported into the Anthropic branch of `classifyFallbackError` in [`accountFallback.js`](../../open-sse/services/accountFallback.js), and carried through [`accountErrors.js`](../../src/sse/services/auth/accountErrors.js). |
| `open-sse/services/quotaResetParsing.ts` | Shared ISO parser learns `regain access on <date> at <time> UTC` | Not ported as a shared parser change: DurinDoor has no equivalent shared parser. `parseAnthropicRegainAccessResetMs` reads only this clause, from the Anthropic message already validated by the credit check. |
| `open-sse/services/accountFallback/creditExhaustionSignals.ts` | Adds `free quota has been exhausted` and the usage-limit phrase to the generic credit substring list | **Rejected.** A substring list applies to every provider and to any position in the text, so a caller-echoed 400 could lock a shared key. The usage-limit phrase is recognized only by the anchored Anthropic check. The 403 sentence already matched DurinDoor's anchored `detectQuotaExhaustion`. |
| `tests/unit/credit-and-free-quota-400-403-21250.test.ts` | Fixtures | Re-expressed in [`port-omniroute-anthropic-usage-limit-21440.test.js`](../../tests/unit/port-omniroute-anthropic-usage-limit-21440.test.js) with synthetic text and no upstream error captures. |

## Call path and resulting behavior

1. `chatCore` renders a failed upstream response as `[status]: message` and keeps the parsed JSON body as `errorBody`. The single-model loop passes both to `markAccountUnavailable`; combos call `checkFallbackError` with the body as `structuredError`.
2. `markAccountUnavailable` first runs `detectQuotaExhaustion`. On a 403 without a parsed body it now drops the gateway's own `[403]: ` prefix (`quotaDetectionText`), so `The free quota has been exhausted...` writes the existing resetless `quotaLockout`. Before this change a leading `[` was taken for JSON and the check silently failed. Other statuses keep their text unchanged. Permission and product-access 403s do not begin with a quota phrase and keep the generic 403 cooldown.
3. `classifyFallbackError` rule order: replay-buffer, 499, OpenRouter 404, Codex 404, `ERROR_RULES` entries with a status and `fallback: false` (only 413), DashScope unpaid codes, then the Anthropic branch. No terminal rule covers 400, so the Anthropic branch is reachable, and it runs before the generic `invalid_request_error` request-scoped exit. That ordering keeps ordinary Anthropic validation 400s request-scoped.
4. The Anthropic branch matches only on `anthropic`, `claude` and `anthropic-compatible-*`, only on status 400, and only when the message *begins* with either phrase inside an `invalid_request_error`/`billing_error` envelope, or as a bare body. It returns `terminal: true`, `scope: "connection"`, `creditsExhausted: true`. Aggregators (`openrouter`, `openai-compatible-*`) never reach it, so their model scopes and request-scoped 400 handling are unchanged.
5. A valid future `regain access on` reset becomes `cooldownMs`, `quotaResetAtMs` and `retryHintSource: "body_iso_reset"`, clamped to `MAX_RATE_LIMIT_COOLDOWN_MS` (7 days). Without one, the cooldown stays at the existing terminal billing value (`COOLDOWN.long`, 2 minutes). Operator `retryDelayByProvider` still replaces it, as for any other terminal rule.
6. In `markAccountUnavailable`, a `creditsExhausted` result takes its deadline only from `quotaResetAtMs`. Caller `resetsAtMs`, caller rate-limit evidence and the prose-countdown ceiling are ignored, so a `Retry-After` or `retry in 60s` cannot end the billing pause early. The connection-wide scope writes `modelLock___all`, and selection moves to the next account.

Parsing rules: `YYYY-MM-DD`, then `T`, a space or ` at `, `HH:MM` with optional `:SS`, and an optional `UTC`, `Z`, `±HH:MM` or `±HHMM` zone. A time without a zone is read as UTC, as in the upstream parser. Impossible calendar days (Feb 30), month 0 or 13, hour 24, minute or second 60 or more, offsets beyond ±14:59 and instants at or before now return null.

Codex and Antigravity quota evidence, the Antigravity strike breaker and the request-replay policy are unchanged. Codex, Antigravity and Qoder branches all run before or apart from the Anthropic branch, and the related suites still pass.

## Known limits

- Operator `providerErrorRules` are consulted after the Anthropic branch, so they cannot override it. The `credit balance` rule from #21076 already worked this way.
- A naive-time reset is assumed to be UTC. Anthropic's message states `UTC`, so this only affects malformed variants.
- A resetless 403 free-quota lockout needs manual reactivation or a credential change, as for every other resetless `quota_exhausted` lockout.

## Verification

Run offline with mocked transports and a temporary SQLite `DATA_DIR`: the new contract file (13 cases, two connections, a combo, positives and negatives) plus the 172 existing unit files that use `checkFallbackError`, `markAccountUnavailable` or `detectQuotaExhaustion`, with `maxWorkers=2`. With the source change reverted, 9 of the 13 new cases fail; the 4 that pass are the preserved negative and combo cases.
