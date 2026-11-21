# #1073: Existing quota status classification

## Pins and scope

- OmniRoute PR [#20776](https://github.com/cheaper-inference/OmniRoute/pull/20776), head `d7727a7e99d74f1ef9cb8a669e26b5bd2fc4fba0`.
- Enclosing merge `78a20f38dc957ac17daf69e3215ec5a955390342`. The PR-specific change was isolated from the merge's unrelated release changes by comparing the merge's second parent with its head; the relevant files are `open-sse/services/errorClassifier.ts`, `open-sse/services/quotaTextCooldowns.ts`, and `tests/unit/subscription-quota-400-status-gate.test.ts`.
- This review covers ordinary structured provider errors and quota fallback classification only. It does not change endpoint semantics, account-rotation permissions, sign-in, or billing.

## Public patch

PR #20776 adds a status-aware wrapper around subscription quota text matching. For HTTP 400, subscription/plan usage phrases count only when an accepted structured quota/credit code is present or when the provider is in the documented message-only 400 allow-list (`command-code`, `bai`, or an `openai-compatible-` prefix). Other statuses retain the existing text match. Its new offline test covers echoed request phrases on 400, quota-coded 400 controls, the message-only allow-list, and 429/403 controls. See the [pinned PR diff](https://github.com/cheaper-inference/OmniRoute/commit/d7727a7e99d74f1ef9cb8a669e26b5bd2fc4fba0) and [PR](https://github.com/cheaper-inference/OmniRoute/pull/20776).

## Current local behavior and fixture evidence

- `open-sse/services/accountFallback.js` treats ordinary 400 `invalid_request_error` responses as request-scoped before generic fallback rules; its existing special case checks recognized terminal billing text, then returns without account fallback. Other unmatched 4xx responses also return request-scoped. The status policy already prevents an echoed ordinary 400 phrase from cooling a shared account.
- True quota handling remains status-sensitive: `checkFallbackError` invokes `parseRateLimitEvidence` for 429, and carries `rateLimitEvidence` with `state: "exhausted"` when explicit quota evidence is present. `tests/unit/apikey-429-quota-exhausted.test.js` checks weekly quota text, reset windows, and transient 429 controls. `tests/unit/account-fallback-request-scoped-4xx.test.js` checks ordinary 400 request scoping and the explicit Anthropic credit-exhaustion exception. `tests/unit/chat-quota-fallback.test.js` also includes a 400 prompt-echo fixture that expects no quota fallback.
- The local generic quota evidence parser in `open-sse/utils/error.js` recognizes structured quota codes and explicit quota text, but its runtime use for persisted exhausted rate-limit evidence is under the 429 path. Local provider-specific structured quota rules remain in `open-sse/config/providerErrorRules.js` and have their own tests, including `tests/unit/agentrouter-error-rules.test.js` and `tests/unit/provider-rate-limit-evidence.test.js`.
- Checked-in fixtures therefore show both protections relevant to this review: ordinary 400 errors do not rotate or mark accounts unavailable, while actual 429 quota evidence and specifically configured provider quota forms continue to use their established paths. No endpoint or rotation change is needed to keep these behaviors.

## Disposition

**#20776 — do not port.** The patch addresses broad text-only subscription classification on 400 in its source tree. The current local fallback implementation already keeps ordinary 400 request errors out of the account cooldown path, and the local offline fixtures cover that behavior alongside true 429 quota exhaustion and provider-specific structured quota handling. No narrower gap is demonstrated by the compared patch that warrants changing this fork's existing status or fallback policy. In particular, this report does not recommend expanding generic 400 rotation based on quota-like wording; preserve the existing provider-specific exceptions and quota controls.

## Offline acceptance

No implementation change is proposed, so no new test is required. Existing offline acceptance evidence is the source and fixture inspection above; no live provider request or account mutation was performed. If a future local fixture demonstrates a gap, acceptance should cover a caller-echoed ordinary 400 remaining request-scoped, an explicitly recognized provider quota 400 retaining only its documented provider-specific behavior, and genuine 429 quota evidence still falling back with its existing reset/cooldown semantics.
