# Open upstream PR ports: batch 22, port candidates 1–4

Source: [batch 22 dispositions](open-prs-nov25-22.md). The work order asked for port candidates 1–8. The source report has only four port-candidate rows (843, 845, 860 and 868), so there are no candidates 5–8. It also states that only 5 of its 40 requested rows have dispositions. The other 35 were not evaluated there or here. Row 848, its one other row, is listed below for completeness.

All four candidate PRs are in `cheaper-inference/OmniRoute`. Their current heads and changed-file diffs were fetched for this change. Each was open, and each head matched the source report. Before this change, `git log --grep` found no earlier port of these PR numbers.

| Row | PR | Head SHA | Final disposition | Evidence |
|---:|---|---|---|---|
| 843 | OmniRoute [#20530](https://github.com/cheaper-inference/OmniRoute/pull/20530) | `d038a640e12137cb2ad942f8812449028dbacae7` | **ported in this change** | Adapted. A short billing notice in stream deltas was relayed as the combo's answer. [The stream peek](../../../open-sse/utils/streamContentPeek.js) now uses [a billing-notice gate](../../../open-sse/utils/billingNotice.js), and [combo routing](../../../open-sse/services/combo.js) fails over with status 402. See the compatibility choices below. [Test](../../../tests/unit/port-omniroute-20530-streamed-billing-notice.test.js). |
| 845 | OmniRoute [#20525](https://github.com/cheaper-inference/OmniRoute/pull/20525) | `8d31012faf4d54f5713a0a6f20136c2d28263eb1` | **ported in this change** | The quota half was already present: [Codex usage](../../../open-sse/services/usage/codex.js) calls [the binding check](../../../open-sse/services/usage/codexCredentialBinding.js) before any request. The refresh half was missing. [The connection store](../../../src/lib/db/repos/connectionsRepo.js) now refuses a rotated token that names another identity, and [token refresh](../../../src/sse/services/tokenRefresh.js) does not dispatch a refused token. [Test](../../../tests/unit/port-omniroute-20525-codex-refresh-identity.test.js). |
| 848 | OmniRoute [#20521](https://github.com/cheaper-inference/OmniRoute/pull/20521) | `71777b67a7459b2e408f021c21a182ba9d7b8d62` | **not applicable** | Not a port candidate, and its head was not fetched again. `scripts/check/check-openapi-security-tiers.mjs` and `src/server/authz/routeGuard.ts` are absent here. |
| 860 | OmniRoute [#20466](https://github.com/cheaper-inference/OmniRoute/pull/20466) | `513389429ea22a9f583fe3496a5c89b83c775093` | **ported in this change** | Adapted. DurinDoor did not estimate on every delta, but each finish event and the final flush serialized the request again: a three-choice passthrough stream serialized it four times. [Streaming](../../../open-sse/utils/stream.js) now computes the input estimate once per stream, with the same usage values. [Test](../../../tests/unit/port-omniroute-20466-usage-estimate-once.test.js). |
| 868 | OmniRoute [#20430](https://github.com/cheaper-inference/OmniRoute/pull/20430) | `b685758ad70970a539536bf31549fc10802483a3` | **already present** | Duplicates #20466, ported in this change, so one stream now serializes its body once. Its other two fixes have no local target. `estimateInputTokens` in [usage tracking](../../../open-sse/utils/usageTracking.js) divides the JSON length by four and runs no regular-expression split. `open-sse/utils/earlyStreamKeepalive.ts` is absent, and no local source under `open-sse/` or `src/` calls `copyWithin`. |

## Compatibility choices

- **Billing notice scope.** Upstream checks every provider. DurinDoor checks only the providers on the allowlist in [the fake-success classifier](../../../open-sse/services/fakeSuccessBodyClassifier.js), `pollinations` and `perplexity-web`, including their aliases. This keeps the existing narrow scope for judging a successful answer by its text.
- **Billing notice timing.** Upstream decides only on text already buffered in one read. DurinDoor's stream transform sends one line per chunk, so that rule would miss a notice split across deltas. For allowlisted combo members, text is held until the stream ends or reaches 512 characters. Short answers from these providers therefore arrive all at once, and longer ones start late. Other providers stream as before.
- A tool call, reasoning, or completion usage counted by the provider releases the held text. Usage marked `estimated` by the gateway does not.
- The text must match upstream's exhaustion pattern or the existing fake-success classifier. A short real answer from an allowlisted provider that uses these phrases also fails over.
- Direct single-model streams are unchanged.
- **Codex refresh guard.** Upstream guards one persistence function. Here the check runs on the stored row inside the connection store's write transaction, for writes marked as a refresh. This covers the shared refresh coordinator, background and media refresh, the connection test and the translator send route. A new sign-in or import is not checked.
- DurinDoor also checks a rotated ID token. Opaque and claim-light tokens are still accepted. The rejection log names a reason code only.
- A refused rotation keeps the stored credentials. The provider may already have consumed the old refresh token, so the account can need a new sign-in.

## Open finding outside this slice

The non-streaming fake-success check does not match the Pollinations wording quoted by #20530. Its signal list has no "enough credits" or "please top up" phrase. #20530 changes only the streaming path, so this change leaves the non-streaming check as it is.

## Verification limits

All checks are offline assertions. No browser, live provider or PostgreSQL check ran, and the full suite was not run. ESLint was not run; the anti-slop gate was.
