# Native OCR dispatch foundation (staged), 2026-11-27

Issue #2034. This module is staged and not registered. Nothing in production imports `open-sse/services/providerParity/native-ocr-foundation/`, and DurinDoor has no `/v1/ocr` route. The module holds only the provider-neutral contract. Each provider adapter is a separate unit, and this one stages no provider.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout at `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/ocrRegistry.ts` defines the following:
  - `OcrTransformation`: `buildRequest`, `parseResponse`, and an optional `pollUrl`.
  - `OCR_PROVIDERS`: `mistral`, `azure-document-intelligence` and `vertex-deepseek-ocr`.
  - `parseOcrModel`: accepts a `"<provider>/<model>"` prefix, a bare registered id, or the `mistral-ocr-` prefix as a fallback.
  - The response shape `{ pages: [{ index, markdown }], model, usage_info? }`.
- `open-sse/handlers/ocr.ts` defines the following:
  - `handleOcr`: `document` is required, and the model defaults to `mistral-ocr-latest`. It picks the provider from the model and sends the token from `accessToken || apiKey`. The connection's `baseUrl` overrides the registry. It sends one fetch with no deadline. Upstream error text is sanitized and relayed. Any thrown error becomes a 500.
  - `pollOcrOperation`: polls only an `Operation-Location` on the same origin. It makes 30 attempts, 1000 ms apart, and refuses redirects. A `failed` status returns 502, and running out of attempts returns 504.
  - `buildOcrSuccessResponse`: if accounting fails, the delivered result is still returned, and an unknown cost stays unknown.

## Local equivalence

- `git ls-files | rg -i ocr` finds only `open-sse/utils/kiroCreateResponse.js`, which is unrelated, and `tests/unit/port-10400-chutes-ocr-seed.test.js`, which is a chat-model seed.
- `open-sse/handlers/` has no OCR core. `src/app/api/v1/` has no `ocr` route.

Result: DurinDoor has no OCR path. This module is the provider-neutral delta.

## What is staged

- `defineOcrAdapter(spec)` is the source `OcrTransformation`, plus the pieces the source kept elsewhere:
  - Models, with an optional `acceptsModel` passthrough.
  - The https origins that requests and polls may target.
  - `authHeaders(credentials)`.
  - Optional request-field validators.
  - Document type and inline media narrowing.
  - `pollState` for async jobs.
- `createOcrDispatcher({ adapters, fetchImpl, sleepImpl, timeoutMs, maxResponseBytes }).dispatch({ provider, body, credentials, signal })`. The caller has already selected the provider and connection, and dispatch runs that provider's adapter.
- `validateOcrRequest`, `resolveOcrModel`, `normalizeOcrDocument`, `normalizeOcrResult`, `ocrAccounting`, `ocrAcceptedJob`, `ocrRefusal` and `ocrReject`.
- `registration.json` holds the following:
  - Source attribution.
  - Ported and not-ported items.
  - Intentional contract changes.
  - The export list and the adapter interface.
  - The result and failure contract.
  - Bounds and integration points.

## Intentional contract changes (gateway safety)

- No auth is invented. The foundation adds no header of its own. If `authHeaders` returns null or throws, or returns a header value with CR/LF, the request is refused with 401 before anything is sent.
- `model` is required and must resolve to the selected adapter. It may be `<provider>/<id>`, a listed id, or an id accepted by `acceptsModel`. There is no default model and no `mistral-ocr-` fallback, because both are specific to one provider.
- The document must be exactly one of `document_url` and `image_url`. `image_url` may also be `{ url }`. An optional `type` must match the field that is present.
  - A URL must be https and at most 8192 characters. It must have no userinfo and must not point to a blocked host (`isBlockedHost`). The fragment is dropped.
  - An inline document must be a base64 data URL of an accepted media type: PDF, PNG, JPEG, WebP, GIF or TIFF, narrowed further by the adapter. An `image_url` must be an image. The decoded size must be between 1 byte and 50 MiB, and the length is checked before the regex runs.
- Top-level fields other than `model` and `document` are refused unless the adapter declares them. The source forwards the whole body.
- Connection base URLs are not honored. The submit target and every poll must be on one of the adapter's https origins. A poll must also be on the submit origin, which is the source rule. A relative status URL is resolved against the submit URL.
- One deadline (300 s by default) covers the submit, every sleep and every poll. Redirects are refused on both the submit and the polls. Success bodies are capped at 32 MiB, and error bodies at 16 KiB.
- Upstream text is never quoted. Refusals are mapped by status:
  - 401, 403 and other 4xx statuses keep their status.
  - 402 is flagged `quotaExhausted`.
  - 429 and 503 keep usable `Retry-After` evidence.
  - Other 5xx statuses become 502.
- Failures carry `acceptedJob` (an unknown-cost `accepted-job` accounting entry) whenever the provider may have done the work, and they are never replayed:
  - `submit-unknown`: a 5xx, a submit redirect, a transport error after the connection, or a deadline or abort before the answer.
  - `accepted`: the submit returned 2xx and the result was then lost. This covers a refused or redirected status check, a failed or unknown job state, polls running out, an unreadable or oversized answer, an answer in the wrong shape, an adapter parse error, and a deadline or abort after the answer.
  - Pre-connect transport errors (`ENOTFOUND`, `EAI_AGAIN`, `ECONNREFUSED`, connect timeout) and a caller abort before the send carry no `acceptedJob`. A caller abort before the send is also marked `local`.
- Normalized pages keep only `index` and `markdown`. Indexes must be unique non-negative integers, and pages are sorted by index. `usage_info` keeps only primitive values. Accounting counts `nativeUnits.pages` from `usage_info.pages_processed`, or from the returned pages when that field is missing, and the cost stays unknown.
- The success result reports the input document without its inline bytes.

## Not ported

- The `OCR_PROVIDERS` entries, with their models, base URLs and auth: Mistral Bearer, Azure `Ocp-Apim-Subscription-Key`, and Vertex service-account token minting with project and region URL building. These belong to provider adapters, each sourced from its own vendor contract.
- OmniRoute meta response headers and request ids. DurinDoor has no equivalent.

## Tests

`tests/unit/native-ocr-foundation.test.js` (92 cases) uses closed mocks only. The injected transport fails on any unexpected request, and every key is synthetic. There are two synthetic fixture adapters, and their origins, headers and bodies were made up for the tests:

- A synchronous adapter shaped like Mistral: a Bearer key and the pages in the answer.
- An asynchronous adapter shaped like Adobe: a client id header plus a Bearer token, a `201` response with `location`, and status polling.

The tests cover the following:

- Adapter definition.
- Request, model and document validation, including SSRF hosts and inline bounds.
- Selected-provider dispatch.
- Adapter-only auth.
- Origin checks.
- Refusal mapping and checks that nothing leaks.
- Redirects, deadlines and aborts.
- Lost results.
- Polling, including the cross-origin, redirect, failed, exhausted and deadline cases.
- Normalization.

The unregistered-state assertions are kept in one final `staging:` block. That block is the only part that registration may promote.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-ocr-foundation.test.js --maxWorkers=2
```

## Registration (serial, not done here)

1. Add `open-sse/handlers/ocrCore.js`. It builds one dispatcher from the registered adapters and calls `dispatch` with the selected connection. On success it records `result.accounting`, and on failure it records `result.acceptedJob`. It stops account fallback when the result has `acceptedJob` or `local`.
2. Add the `POST /v1/ocr` route. It parses JSON within a size cap, selects the provider and connection, and returns `result.response`.
3. Stage each provider adapter as its own unit, sourced from its own vendor contract.
4. Document `/v1/ocr` in `docs/providers/catalog.mdx` after the first provider is registered.
