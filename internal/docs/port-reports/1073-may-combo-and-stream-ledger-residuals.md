# #1073 — May combo and stream ledger residuals

Static comparison against DurinDoor base `d22ab0b713e6e36763a1bb96838d6c26e3d42aa0` on 2026-11-21. The exact public PR heads are pinned below. For merge heads, the named PR patch is used to exclude unrelated release synchronization. This is a docs-only audit; no tests were run and no product behavior was changed.

## Source pins

| PR | Exact head / named patch | Enclosing merge |
| --- | --- | --- |
| OmniRoute #1919 | [`cfc61ec9d772ee4d32d91716243573ac3cfc4dbc`](https://github.com/cheaper-inference/OmniRoute/commit/cfc61ec9d772ee4d32d91716243573ac3cfc4dbc) · [PR patch](https://github.com/cheaper-inference/OmniRoute/pull/1919.patch) | `0c27b89c635c329b69e4c57b28f84d47420e18e0` |
| OmniRoute #2156 | [`51dbcd7b9201f7379efc033c653bbe00f1f68c04`](https://github.com/cheaper-inference/OmniRoute/commit/51dbcd7b9201f7379efc033c653bbe00f1f68c04) · [PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2156.patch) | `d3e0353203a016c693b21021c050bb5369a950c6` |
| OmniRoute #2202 | [`24dfb4b2326ed50bcc5f64ee237e9ad3f64b3f89`](https://github.com/cheaper-inference/OmniRoute/commit/24dfb4b2326ed50bcc5f64ee237e9ad3f64b3f89) · [PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2202.patch) | `e6aee3d26cbcffb800440cc13b811ab1c9b5a05e` |
| OmniRoute #2233 | [`db66a7b5dd6401a29e237b4718cc7a674398281c`](https://github.com/cheaper-inference/OmniRoute/commit/db66a7b5dd6401a29e237b4718cc7a674398281c) · [named PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2233.patch) | `b9db934e39776cd739218acfc61ef339c7af11a2` |
| OmniRoute #2236 | [`a10883d0427c68dcd8ff8966a7b2d5ecdfd8b1c4`](https://github.com/cheaper-inference/OmniRoute/commit/a10883d0427c68dcd8ff8966a7b2d5ecdfd8b1c4) · [named PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2236.patch) | `0c3d33899de82adee89a0cad64b6274fe2edf0d8` |
| OmniRoute #2253 | [`7c898587972b1889c2fcf8f88b67c4d0d0722e9d`](https://github.com/cheaper-inference/OmniRoute/commit/7c898587972b1889c2fcf8f88b67c4d0d0722e9d) · [PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2253.patch) | `1d21eb1686c5d365a8173a26a3ab7a2e0012975e` |
| OmniRoute #2264 | [`8b815b738e97a7cad658287f3eb7996c2f3e1503`](https://github.com/cheaper-inference/OmniRoute/commit/8b815b738e97a7cad658287f3eb7996c2f3e1503) · [named PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2264.patch) | `955049186f22f7b3a504e6b03a4f99cf69a76b8b` |
| OmniRoute #2289 | [`a591bdbb5a3f96b5989b8dcb7c792aebe193b20c`](https://github.com/cheaper-inference/OmniRoute/commit/a591bdbb5a3f96b5989b8dcb7c792aebe193b20c) · [named PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2289.patch) | `04335c5a6be9339ba7aadc3618c3054534e06fdd` |
| OmniRoute #2338 | [`2ce7894f7641a0bae9e5d3f26524961e7b9f5066`](https://github.com/cheaper-inference/OmniRoute/commit/2ce7894f7641a0bae9e5d3f26524961e7b9f5066) · [named PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2338.patch) | `193e7a64174faf389b1c963c4ccbdab278f46463` |
| OmniRoute #2494 | [`9989ac799fb9f05c03e8d24fc1a09ef503ac93d1`](https://github.com/cheaper-inference/OmniRoute/commit/9989ac799fb9f05c03e8d24fc1a09ef503ac93d1) · [PR patch](https://github.com/cheaper-inference/OmniRoute/pull/2494.patch) | `3e84b81f6fa2e3fd8ad63b2132296a589115d27f` |

## Dispositions

### #1919 — Copilot-compatible Responses reasoning deltas

The patch detects Copilot clients, emits `delta.reasoning_text` for Responses `response.reasoning_summary_text.delta`, preserves that field through sanitization, and counts it as valuable stream content. DurinDoor's [`extractReasoningText`](../../../open-sse/translator/concerns/reasoning.js) already reads `reasoning_text`, and [`openai-responses.js`](../../../open-sse/translator/response/openai-responses.js) maps Responses reasoning events for ordinary client formats. However, [`hasValuableContent`](../../../open-sse/utils/streamHelpers.js) accepts `content`, `reasoning_content`, and `reasoning`, but not `reasoning_text`; the pass-through filter can therefore discard a reasoning-text-only OpenAI chunk. There is no Copilot-client mode in the local stream setup. Existing Responses fixtures cover reasoning translation but not this Copilot wire shape.

**Disposition: narrow client-compatibility candidate.** Ordinary offline acceptance: feed a Responses reasoning-summary delta through chat-completions translation with a Copilot-like client header; assert a non-empty `reasoning_text` chunk reaches the client, is not discarded by the valuable-content gate, and that ordinary clients retain the existing `reasoning_content`/Responses behavior. Add assertions to the relevant Responses translation and stream-helper fixtures. No network or credential is needed.

### #2156 — debug call-log payload bounds

The named commit moves chat-log bounds into configurable helpers and changes how debug-mode call-log payloads retain raw request/response JSON. It does not change combo selection, SSE framing, readiness, or provider execution. Current chat logging and capture are handled in [`chatCore.js`](../../../open-sse/handlers/chatCore.js) and its request-detail helpers; these are logging-policy changes, outside this combo/stream behavior row.

**Disposition: not a combo or stream-runtime port.** Do not infer a transport behavior change from this logging patch.

### #2202 — ModelScope 429 classification, retry, and model-scoped quota

The PR adds ModelScope header/body classification, bounded retries for retryable 429s, and a per-model lock when quota is exhausted, leaving the connection usable for other models. The later pinned test commit also changes classification so a zero remaining header alone is treated as rate limiting when another quota header is present. DurinDoor has generic 429 handling in [`chatCore.js`](../../../open-sse/handlers/chatCore.js) and provider-specific error rules in [`providerErrorRules.js`](../../../open-sse/config/providerErrorRules.js), but no ModelScope classifier, retry-delay policy, or ModelScope offline fixture.

**Disposition: narrow provider-policy candidate; not implemented.** Ordinary offline acceptance must use fake responses only: a ModelScope 429 with throttle headers retries no more than the source's bound and then succeeds on a subsequent fake response; explicit exhausted-quota evidence applies a model-scoped lock while a second model on the same connection remains eligible. Also assert that cancellation during the retry wait stops the attempt, the request reservation is released once, and only the eventual terminal outcome is settled/accounted once. Avoid real provider calls. This test boundary is needed before deciding how the retry interacts with DurinDoor's request reservation and combo fallback ownership.

### #2233 — SSE heartbeats and idle timeout ceiling

The named patch adds configurable, post-transform heartbeat output shaped for Claude, Chat Completions, and Responses, plus an in-progress event for Responses; it also changes upstream idle-timeout defaults. DurinDoor's [`handleStreamingResponse`](../../../open-sse/handlers/chatCore/streamingHandler.js) injects client-format pings only for Claude. [`pipeWithDisconnect`](../../../open-sse/utils/streamHandler.js) owns raw-byte TTFT/stall watchdogs and client cancellation; [`runtimeConfig.js`](../../../open-sse/config/runtimeConfig.js) defaults the first-byte budget to 200 seconds and inter-chunk stall to 360 seconds. [`stream-first-chunk-timeout.test.js`](../../../tests/unit/stream-first-chunk-timeout.test.js) covers timeout classification and cancellation. There is no matching general heartbeat transform or heartbeat fixture.

**Disposition: heartbeat framing is a protocol candidate; timeout-default change is not adopted.** Ordinary offline acceptance for a heartbeat candidate must prove that a quiet OpenAI Chat stream receives a valid no-content frame, the real provider bytes and terminal frame remain ordered and unchanged, client cancellation stops heartbeat production and the source reader, and watchdog/accounting callbacks still run once. Responses in-progress framing additionally needs an offline sequencing assertion showing it cannot precede or duplicate an invalid lifecycle transition. No new timeout tier is justified by this patch; retain local TTFT/stall policy and ownership.

### #2236 — Azure AI/OCI Responses transport selection

The named PR carries model API format into chatCore, removes incompatible `stream_options` for Responses upstreams, and forces Azure AI/OCI endpoint selection to `/responses` when the selected model requires that format. Local [`getTargetFormat`](../../../open-sse/services/provider.js) honors a connection's `providerSpecificData.apiType`; [`DefaultExecutor.buildUrl`](../../../open-sse/executors/default.js) chooses `/responses` only from that connection setting. `tests/unit/omniroute-missing-api-cloud-providers.test.js` covers Azure AI's configured `apiType: responses` path, but not a model-level Responses selection on a connection still configured for chat.

**Disposition: narrow transport-selection candidate.** Ordinary offline acceptance: with an Azure AI connection set to `apiType: chat` and a model-level Responses target, assert the request uses the configured base URL's `/responses` endpoint, strips `stream_options`, and preserves unrelated request fields. Also assert that a chat-target model on the same provider still uses `/chat/completions`. Use a mocked executor/fetch; no credentials or traffic to Azure.

### #2253 and #2264 — forwarded response headers

The exact #2253 patch builds streaming headers that denylist upstream `Content-Type`, `Content-Encoding`, `Content-Length`, and `Transfer-Encoding` before setting the gateway's SSE headers. The named #2264 PR patch is broader and includes security work; its relevant later commits remove stale encoding/length/transfer framing from a buffered forwarding path. DurinDoor's [`handleStreamingResponse`](../../../open-sse/handlers/chatCore/streamingHandler.js) returns a fresh response using the local `SSE_HEADERS` object after transforming the body, so the provider's framing headers do not reach the client. Its JSON-to-SSE conversion deletes `content-length` when rebuilding the provider response. The existing [`omni-stream-buffering-response-headers.test.js`](../../../tests/unit/omni-stream-buffering-response-headers.test.js) covers locally constructed SSE header contracts; normal and forced-stream-to-JSON paths also build client responses from fixed local headers.

**Disposition: no demonstrated client-header gap in the reviewed paths.** The upstream header helpers are not needed where DurinDoor discards provider headers when constructing its final response. Do not alter request/provider ownership or add a broad upstream-header forwarding path based on these patches.

### #2289 — size-adaptive stream readiness

The named PR adds a body-size-aware readiness policy for large Responses requests, capped at 120 seconds, and applies it before committing the client stream. DurinDoor has no equivalent size-derived policy. Its [`streamContentPeek.js`](../../../open-sse/utils/streamContentPeek.js) uses the fixed `STREAM_FIRST_CHUNK_TIMEOUT_MS` (200 seconds by default) for combo content peeking, while [`pipeWithDisconnect`](../../../open-sse/utils/streamHandler.js) applies a raw-byte first-chunk watchdog after the response path begins. The offline [`stream-first-chunk-timeout.test.js`](../../../tests/unit/stream-first-chunk-timeout.test.js) covers that fixed raw-byte watchdog; combo stream fixtures cover empty-stream fallback.

**Disposition: no default-timeout residual demonstrated; do not add a timeout tier.** The local default already exceeds the source policy's cap, although its raw-byte and combo-content readiness meanings differ. Any future report of a false readiness failure must include a deterministic, offline large-request fixture that reaches useful content inside the proposed budget but beyond the currently configured budget, while proving cancellation and a single fallback/accounting outcome. The source patch alone does not establish that local case.

### #2338 — last-good combo account affinity

The named patch changes last-known-good state from provider-only to provider plus `connectionId`, then prioritizes that account when it remains among the combo targets; it retains provider fallback when the remembered account is absent. DurinDoor's [`handleComboChat`](../../../open-sse/services/combo.js) tracks member order, rotation, and conversation affinity, but does not persist a last-good provider/account record. The current [`combo-routing.test.js`](../../../tests/unit/combo-routing.test.js) covers model rotation, and [`combo-connection-usage-attribution.test.js`](../../../tests/unit/combo-connection-usage-attribution.test.js) verifies that the actually selected connection is attributed to usage; neither tests account preference across combo requests.

**Disposition: narrow account-affinity candidate; not implemented.** Ordinary offline acceptance: with two eligible fake connections for one combo target, a successful first request records the actual `connectionId`; the next request prefers it only while it remains eligible and in the caller's allow-list. A removed, disabled, or disallowed remembered ID must fall back to current selection. Verify streamed and non-streamed requests retain the selected ID in usage attribution and settle once. This must remain a preference within existing eligibility and combo ordering, not a new routing mode.

### #2494 — unavailable-credential log wording

The exact patch changes two log messages from “all accounts in cooldown” to a broader unavailable-credentials/model-excluded description. DurinDoor's [`combo.js`](../../../open-sse/services/combo.js) does not have the corresponding `isModelAvailable` pre-check or those misleading messages; it attempts the selected member and handles its result through the existing fallback classifier.

**Disposition: no matching behavior to port.** No runtime state, selection, retry, or accounting changes are present in this local path.

## Boundaries

The five candidates above are limited to ordinary offline cases that can isolate request shaping, protocol output, retry, or account preference. They do not authorize provider traffic, a new timeout tier, a new routing strategy, changes to readiness/cancellation, or duplicate request/usage settlement. This report records candidate acceptance only; it makes no product-code or test changes.

Refs #1073
