# #2034: native audio 503 acceptance contracts

Scope: the two staged, unregistered native audio adapters. Both excluded HTTP 503 from the post-dispatch "5xx means unknown, carry `acceptedJob`" rule. This report checks that exclusion against primary vendor sources. Both adapters stay unregistered.

## Sources (public GET, read 2026-11-27)

Google, Gemini API (the `generativelanguage.googleapis.com` `:generateContent` surface used by Lyria 3):

- [Billing FAQ, "Am I charged for failed, blocked, or canceled requests?"](https://ai.google.dev/gemini-api/docs/billing#am-i-charged-for-failed-requests): "HTTP 4xx or 5xx error (request still counts against quota) | Not billed | Not billed".
- [API errors](https://ai.google.dev/gemini-api/docs/api-errors): `service_unavailable`, 503, "The service is temporarily overloaded or down", "Wait and retry with exponential backoff".
- [Troubleshooting, retry strategy](https://ai.google.dev/gemini-api/docs/troubleshooting#retry-strategy): `503 UNAVAILABLE` is listed as retryable.
- [Pricing, Lyria](https://ai.google.dev/gemini-api/docs/pricing): Lyria 3 and 3.5 are priced per song.

HuggingFace, Inference Providers router (`router.huggingface.co/hf-inference/models/...`):

- [Pricing and Billing](https://huggingface.co/docs/inference-providers/pricing): with hf-inference, "you get charged for every inference request based on the compute time x price of the underlying hardware".
- The current `huggingface/hub-docs` tree (`docs/inference-providers/**`) has no 503 contract, no "model is loading" contract and no `estimated_time` field. The old serverless Inference API pages that described a 503 "model is loading" answer are no longer published.
- Official clients: `huggingface.js` `packages/inference/src/utils/request.ts` retries any 503 by default (`retry_on_error`, "If a request 503s, the request will be retried with the same parameters"). `huggingface_hub` retries 503 among other 5xx codes. That is client retry policy. It does not say whether the work was done or billed.

## Findings

**Gemini Lyria: the existing classification is correct, and the runtime is unchanged.** The billing FAQ is a status-level guarantee: any HTTP 5xx is not billed. A 503 therefore needs no structured body proof. The adapter keeps 503 as `outcome: "refused"` with no `acceptedJob`, keeps Retry-After as `resetsAtMs`, and surfaces only the enumerated `error.status` label. The same FAQ would also allow 500, 502 and 504 to be refusals. The adapter still treats them as unknown-cost accepted jobs, which is the more conservative choice. They are outside this task and are left unchanged. One gap remains: the FAQ's columns are token columns, while Lyria is priced per song. No Google document says per-song charges apply to an HTTP error. A comment citing these sources was added at the branch.

**HuggingFace speech: the existing classification was not proven, and the runtime has changed.** The old comment said 503 meant "model is loading / unavailable (no audio, not billed)". No current primary source supports "not billed" or "no work". hf-inference bills compute time per request, and the router can return 503 for reasons other than model loading. No structured pre-acceptance field is documented. The legacy `estimated_time` and "currently loading" text are not a published contract, so the adapter does not read error text. A HuggingFace 503 now:

- keeps HTTP status 503 and the bounded Retry-After (`resetsAtMs`), so the selected account's health tracking works as before;
- carries `acceptedJob` (`costSource: "accepted-job"`, cost unknown, `jobState: "submit-unknown"`). In the media pipeline (`runMediaAccounts` then `onAccountFailure`), that records the job on the selected account and ends the loop, so the request is never replayed on another account;
- never quotes the upstream body. It is still drained only up to 16 KiB under a 2 s bound.

429, 402, 401 and 403, other 4xx, other 5xx, redirects, aborts and timeouts keep their existing classification.

## Tests

- `tests/unit/native-huggingface-tts.test.js`: 67 tests, all kept. One 503 expectation was strengthened: the loading answer now expects `acceptedJob` and a Retry-After reset.
- `tests/unit/native-google-music.test.js`: 49 tests, unchanged.
- `tests/unit/native-audio-503-contract.test.js` (new, 23 tests) runs each adapter's real wire path with synthetic mocks:
  - 503 bodies that are absent, empty, malformed JSON, HTML, the legacy HuggingFace "loading" shape, a Google `UNAVAILABLE` envelope, or oversized;
  - a 503 without Retry-After;
  - a caller abort while a 503 body stalls, and a stalled 503 body bounded by the deadline;
  - neighbouring statuses (429 and 500/502/504), which keep their classification;
  - two accounts: each 503 is sent once, with only its own key, and attributed to its own connection.
  
  Every case checks that the body text and keys are redacted. With the HuggingFace runtime change reverted, exactly the 11 HuggingFace 503 cases fail.

Evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/native-audio-503-contract.test.js unit/native-huggingface-tts.test.js unit/native-google-music.test.js --maxWorkers=2`. No live provider, account, or paid call was made.
