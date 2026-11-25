# 1073: Late June existing fallback classification

Scope: compare the three pinned OmniRoute changes with this fork's existing account fallback, combo-member retry, Responses error, and Claude OAuth usage paths. This is a documentation audit only. No new quota subsystem, credential handling, sign-in flow, or provider traffic is proposed.

## Pinned public changes

| PR | Exact pin and comparison base | Relevant change |
| --- | --- | --- |
| [OmniRoute #4519](https://github.com/cheaper-inference/OmniRoute/pull/4519) | Head `8edd1704234029950ea0afec0aab279ff9dc896e`; parent/base `d3f1b23a93cb79c2beef4a27824544bc1a7ebe32`; enclosing merge `694adf7e13e99184124300844b2c9efe15c04eb5` | Makes context-overflow and parameter-validation 400s eligible to advance combo targets, classifies parameter validation as request-scoped with no account cooldown, and preserves context/rate-limit error codes and statuses in the OpenAI Responses failure normalizer. The exact feature commit names these three files; its unrelated Codex compression change is not part of the comparison. |
| [OmniRoute #4585](https://github.com/cheaper-inference/OmniRoute/pull/4585) | Head `f148051ae41b1bd9d450fb64a7623615708fb45b`; comparison base `1087d5a406df6fa64a1b7c09482bd838f0551ce5`; enclosing merge `def39ea29222570f369459d508071f8c01533ccb` | The pinned patch's combo hunks are formatting-only; its relevant PR topic is respecting the retry-hint toggle. It does not change account fallback classifications, explicit quota evidence, terminal account status, or Claude usage cooldown. Broad changes in the enclosing merge are excluded. |
| [OmniRoute #4655](https://github.com/cheaper-inference/OmniRoute/pull/4655) | Head `4a734734c4ecfeb84b2b845c547249700d7e92e5`; parent/base `607ad12e842cd021f9cb0a1107d4b2fd280eed41`; enclosing merge `be2ab9e419c1cee9590c98859b208a8f9d45e012` | Adds a three-minute per-access-token suppression window after a Claude OAuth usage endpoint 429, then falls back to the legacy usage endpoint. Chat traffic is unaffected. |

The #4585 pin is a broad integration/cleanup head. Its focused account-fallback comparison shows no accountFallback change; unrelated formatter, UI, runtime, and test edits are not treated as the PR's fallback patch.

## Current local behavior and fixture evidence

### Account boundary and combo fallback

`open-sse/services/accountFallback.js` documents `shouldFallback` as account rotation and `requestScoped` as combo rotation. Unmatched client 4xx failures and ordinary `invalid_request_error` 400s return `shouldFallback: false`, `cooldownMs: 0`, and `requestScoped: true`. Account-scoped status rules run before the generic 4xx path; 401, 402, 403, 404 and 429 therefore retain their existing account/quota classification. For a 429, `parseRateLimitEvidence` only produces persisted exhausted-quota evidence when the body supplies explicit exhausted-quota/reset evidence; a generic transient 429 remains on its existing backoff path. Terminal billing rules remain distinct from retryable cooldowns.

`tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js` exercises unmatched 400/422 and `invalid_request_error`, asserts zero account cooldown, and verifies a combo tries the next member after a validation 400. When all members reject, it returns the first member's status and body; a 499 still stops. `tests/unit/chat-quota-fallback.test.js` covers explicit quota evidence and reset behavior. Thus the narrow account-versus-member distinction behind #4519 is already implemented; no account-boundary change is indicated.

### Context and parameter 400s, and translated terminal errors

The local classifier's generic request-scoped 4xx path already handles context overflow and unsupported parameters without cooling the account. The combo handler consumes the request-scoped result by trying another member. The existing combo fixture includes a context-too-long 400 followed by another member's 422 and verifies both attempts and the original first rejection returned to the caller. This covers the practical target-to-target fallback without adding upstream-specific regexes for `max_tokens` wording.

`open-sse/translator/response/openai-responses.js` and `tests/unit/v5-translated-stream-error-boundaries.test.js` preserve safe translated error `message`, `type`, and `code`, including `context_length_exceeded`; the fixture verifies one failure terminal and suppresses later content. This is streaming error translation, not HTTP status normalization. The local stream fixture proves error-code preservation, while the combo/account fixtures prove fallback policy. Together they cover the observable behavior relevant to #4519; no separate local `normalizeUpstreamFailure` equivalent or demonstrated narrow defect was found.

The existing `tests/unit/empty-stream-terminal-1073.test.js` concerns a different queued terminal-response repair: it replaces a false empty `response.completed` / `message_stop` with an error terminal and preserves useful output. That success-terminal repair is distinct from classifying upstream 400/429 errors or choosing the next combo account/member. Do not count it as evidence for or against the #4519 classifier change.

### Claude OAuth usage cooldown

`open-sse/services/usage/claude.js` already scopes usage cache and 429 strikes by a digest of the access token, honors cooldowns even for forced polls, and escalates consecutive OAuth usage 429s from 15 minutes up to two hours. During cooldown it serves retained last-good quota data when available. This changes only the quota usage poll; normal chat execution is not gated by this usage cooldown. It is more conservative than #4655's fixed three-minute skip and does not expose a raw token as the map key.

`tests/unit/claude-usage-cache.test.js` verifies one upstream fetch during active cooldown, escalation/reset after success, and stale quota serving. `tests/unit/claude-quota-stale-fallback.test.js` verifies retained quota rows across the fresh-cache TTL and no fabricated rows after retention expires. These offline fixtures demonstrate the existing cooldown and stale-data boundary; no gap is shown.

## Dispositions

- **#4519 — already covered; no port.** Existing request-scoped classification prevents account cooldown, combo fallback already advances to another member for context/parameter 4xx, and fixtures preserve the first rejection when no member succeeds. Translated error fixtures retain context codes. The PR's additional message-specific predicates would duplicate broader existing behavior; no local defect is demonstrated.
- **#4585 — no account-classification change to port.** Its pinned change concerns retry-hint toggle behavior and formatting/merge cleanup, not fallback classification, terminal quota state, or usage cooldown. Local combo retry-hint handling is already exercised by `tests/unit/combo-retry-after-port.test.js` and `tests/unit/port-review-followups-1433.test.js`. No classification gap is demonstrated.
- **#4655 — already covered with stronger cooldown behavior; no port.** Local Claude OAuth usage has token-scoped escalating 429 cooldown, forced-poll suppression, and stale-cache fallback, with offline fixture coverage. Do not add a second fixed cooldown map or change account fallback policy.

No demonstrated narrow gap remains, so there is no implementation candidate and no additional acceptance test is needed. Existing ordinary offline fixtures provide the evidence above. No live provider call, paid API, credential inspection, browser, Docker, or end-to-end run was used.
