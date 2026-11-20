# Combo native Responses text configuration (#1072)

Reviewed 2026-11-20 against local base `bc7dd39e48e0`, following the periodic review of the #2070 native Responses output port (`fix(combo): preserve valid native Responses output`, `6f670291e`). That port moved native Responses item recognition into `open-sse/utils/responsesContent.js` and taught the combo emptiness classifier to recognize native output items, but left the generic `text` key ahead of the native branches.

## Residual

A native Responses provider answers a completed request with its own envelope: `object: "response"`, a `status`, native `output` items, and — when the client asked for a text format — the request's text CONFIGURATION echoed back as `text: {"format": {...}}`. That `text` field is metadata about how the answer was requested, not assistant content.

`isBodyEmpty` in `open-sse/services/combo.js` read the generic `text` key before the native Responses branches and treated any non-string `text` as an empty body. A completed response carrying a valid native item — an `image_generation_call` with a non-empty `result` — was therefore classified as empty: combo retried the successful member once more, spent the next attempt on the fallback member, and returned that replacement instead of the provider's image.

The same ordering hid a queued or in-progress receipt that echoed a text configuration, so an accepted background job fell through to a fallback member.

## Change

`open-sse/services/combo.js` now judges a native Responses envelope by its native output items and its envelope status:

- a queued or in_progress receipt stays a receipt, whatever else the envelope carries;
- an envelope with at least one usable native output item is not empty;
- an envelope without a usable native output item is empty — a `text` string is still content, a text configuration object is not.

`open-sse/utils/responsesContent.js` gains `isResponsesEnvelope`, the native envelope predicate next to the existing `isResponsesReceipt` and `hasResponsesContentItem` helpers.

The generic `choices`, `content`, `text`, `candidates` and `output` branches keep their existing semantics for every payload that is not a native Responses envelope, and the empty-body boundary itself is unchanged: a genuinely empty 200 still retries once and then falls through to the next member.

## Evidence

`tests/unit/combo-native-response-text-config-review.test.js` covers the first-member result, the exactly-one-call contract, a valid native image with and without a text configuration, a native text message, a genuinely empty response that carries a text configuration, an invalid image receipt, queued and in_progress receipts with and without a text configuration, the existing empty chat payload, and a plain text configuration object outside a native envelope.

Focused evidence: `test -s tests/unit/combo-native-response-text-config-review.test.js && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/combo-native-response-text-config-review.test.js unit/combo-empty-json-failover-port.test.js unit/combo-patches.test.js)` passes. Root lint passes. The fixtures are synthetic; no provider, browser or media request was made. The integration gate owns the full suite.
