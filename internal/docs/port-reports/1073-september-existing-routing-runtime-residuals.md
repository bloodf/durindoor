# 1073 September routing runtime residuals

Review date: 2026-11-21. Scope is the six named OmniRoute pull requests and their routing/runtime relevance to the current DurinDoor tree. Public links below pin the supplied PR heads and enclosing merge commits. For #14444, the enclosing merge includes the PR patch plus a release merge; the linked PR head is the PR-specific evaluation trace change.

## Pins

| PR | Supplied PR head | Enclosing merge | Public patch |
| --- | --- | --- | --- |
| [#14342](https://github.com/cheaper-inference/OmniRoute/pull/14342) | `1f2268c1106d38547483ff69c15baddd6bfca19e` | `5e5773a355cf5b58c50fe8fa4f5f5210dc9c93b3` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14342.patch) |
| [#14390](https://github.com/cheaper-inference/OmniRoute/pull/14390) | `b33f30605914cef9d383a113350620239980598d` | `078adcafa9ed0f7a86a41f175f3df047bc391d6b` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14390.patch) |
| [#14438](https://github.com/cheaper-inference/OmniRoute/pull/14438) | `1e4957f494e4d798e52109e67c2af30210aa920c` | `9c9618422f143a96a32ab4df77869251b189a387` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14438.patch) |
| [#14444](https://github.com/cheaper-inference/OmniRoute/pull/14444) | `4950c53489d5b9f5d093ccb22934f5c92311029f` | `93bc0b44287f487943db67cb1cd8a5316087bbb0` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14444.patch) (scoped to the PR; the merge's first-parent diff also includes a release merge) |
| [#14474](https://github.com/cheaper-inference/OmniRoute/pull/14474) | `07ed655f1e262141610f21c7b983f79177952429` | `309d0a1e1d7ab89b6c7682ed3888dd46c302d97a` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14474.patch) |
| [#14517](https://github.com/cheaper-inference/OmniRoute/pull/14517) | `d40300a52e719cbea2696e7f20a5ddd8850eab5d` | `e36f35e469cb8b6f28c3df423acc3128a67af9df` | [PR diff](https://github.com/cheaper-inference/OmniRoute/pull/14517.patch) |

## Current behavior and dispositions

### #14342 — propagate client abort after response headers

The upstream patch preserves cancellation through its start-timeout wrapper, stream reader, and combo quality-peek. DurinDoor already has bounded first-byte and inter-chunk deadlines in `open-sse/utils/streamHandler.js`; timeout expiry errors and aborts the stream controller, while `createStreamController` forwards the external request abort into its own signal. `tests/unit/stream-first-chunk-timeout.test.js` checks expiry, abort invocation, and no false timeout after bytes; `tests/unit/empty-stream-guard.test.js` checks that client abort is terminal rather than a retry. Combo attempts have their own bounded timeout and signal in `open-sse/services/combo.js` and `tests/unit/combo-timeout.test.js`. The named upstream PR's routing change is therefore already represented by the local bounded-timeout and abort contracts; this is not evidence of a residual gap.

**Disposition:** already covered by current runtime contracts and offline fixtures; no port or additional test indicated.

### #14390 — preserve native OpenCode conversation identity

The PR shares request-scoped header construction and preserves native conversation identity across translation. Current OpenCode execution derives a controlled session identity and excludes caller-supplied native session headers; `tests/unit/opencode-official-headers.test.js`, `tests/unit/opencode-session-canonical-id.test.js`, `tests/unit/opencode-anonymous-session-isolation.test.js`, and `tests/unit/opencode-go-session.test.js` pin session isolation, stable identity, header behavior, and caller-header rejection. This supports the local control-header boundary; there is no demonstrated missing routing behavior.

**Disposition:** existing local contract covers session scoping and control headers; no port or additional test indicated.

### #14438 — request-level validation 400 must not cool an account

The upstream extracts a request-scoped 400 predicate and avoids connection cooldown for parameter-validation errors. DurinDoor's `open-sse/services/accountFallback.js` marks unmatched/request-invalid 4xx as `requestScoped` with zero cooldown while preserving account-scoped billing/auth/rate-limit classifications. `tests/unit/account-fallback-request-scoped-4xx.test.js` checks no cooldown for invalid request 400, terminal billing 400 behavior, and continued transient handling; `tests/unit/port-5cdcddf5-combo-request-scoped-4xx.test.js` checks combo fallback and request-scoped outcomes. This row is already resolved under the existing route contract.

**Disposition:** already covered by current fallback classification and offline fixtures; no port or additional test indicated.

### #14444 — request-scoped auto-combo evaluation trace

This PR adds quality/evaluation funnel and decision-trace instrumentation to auto-combo selection. Those trace features are absent from this fork's routing runtime. That absence does not imply a changed public routing response contract or a missing timeout, request-scope, header, or attempt-settlement behavior: it is an observability/decision-trace feature, not a demonstrated routing runtime defect. Keep it out of this residual inventory rather than infer API behavior from the trace patch.

**Disposition:** absent feature; no port in this runtime-residual task and no behavior-gap test indicated.

### #14474 — keep attempt usage attached to the live pending request

The PR changes attempt logging so usage is associated with the still-pending request, avoiding stale attempt settlement. This fork has provider-attempt context and request-owned completion paths: `open-sse/services/providerAttemptContext.js` captures dispatch timestamps, `open-sse/handlers/chatCore.js` carries the latest attempt timestamp through completion/error paths, and `src/sse/handlers/chat.js` settles successful pending work using that attempt context. Offline fixtures `tests/unit/provider-attempt-context.test.js`, `tests/unit/chat-stream-success-lifecycle.test.js`, and `tests/unit/stream-early-eof-failover.test.js` exercise attempt attribution, settlement, and the distinction between request-scoped stream failures and retryable outcomes. The upstream's call-log token accounting implementation is API/storage-specific and is not a demonstrated defect in this fork's route behavior.

**Disposition:** current attempt attribution and settlement contract is fixture-covered; the upstream call-log accounting behavior is not applicable here. No narrow routing gap demonstrated.

### #14517 — omit echoed video transcript from retained request detail

This patch is a retained-detail and logging-boundary change, not a routing decision or provider-attempt behavior change. Treat it only as a static access/logging boundary review. The current chat paths explicitly document that raw non-streaming request bodies are not echoed, stored, or logged (`open-sse/handlers/chatCore/nonStreamingHandler.js`), and streaming detail redacts credentials before persistence (`open-sse/handlers/chatCore/streamingHandler.js`). The supplied local fixtures do not establish a video transcript-specific API difference or a routing runtime gap, so this inventory makes no vulnerability or exploit claim.

**Disposition:** outside routing runtime scope; no API behavior change established. A video-detail redaction change would need its own narrowly scoped local source/fixture review before acceptance.

## Acceptance

No demonstrated narrow behavior gap remains in the routing-runtime rows. Existing evidence is ordinary offline unit fixtures listed above; no live-provider, credentialed, exploit, or end-to-end evidence is needed for these dispositions. No product or test changes are proposed by this report.
