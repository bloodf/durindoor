# Azure Document Intelligence native OCR adapter (staged), 2026-11-27

Issue #2034. This adapter is staged and not registered. Nothing in production imports `open-sse/services/providerParity/native-ocr-azure-document-intelligence/`, and DurinDoor has no `/v1/ocr` route. The adapter is built on the staged OCR dispatch foundation (`open-sse/services/providerParity/native-ocr-foundation/`, see [its report](native-ocr-foundation.md)).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The read-only checkout at `/tmp/omni-2034` had this commit as `HEAD`.

- `open-sse/config/ocrRegistry.ts`:
  - `OCR_PROVIDERS["azure-document-intelligence"]`: empty `baseUrl`, `authType: "apikey"`, `authHeader: "Ocp-Apim-Subscription-Key"`, and the single model `prebuilt-read` ("Azure Document Intelligence (Read)").
  - `AZURE_DI_TRANSFORMATION`:
    - `buildRequest`: `POST {endpoint}/documentintelligence/documentModels/{model}:analyze?api-version=2024-11-30&outputContentFormat=markdown`, with `Ocp-Apim-Subscription-Key` and a body of `{ urlSource }` or `{ base64Source }` (`azureDiSource`).
    - `pollUrl`: the `Operation-Location` header.
    - `parseResponse`: `analyzeResult.content` as one aggregated page at index 0, `usage_info.pages_processed` from `analyzeResult.pages.length` (default 1), and `model` hardcoded to `prebuilt-read`.
  - `parseOcrModel`: a `azure-document-intelligence/<anything>` prefix passes any model id through. A bare id must be listed.
- `open-sse/handlers/ocr.ts`:
  - `handleOcr`: the token is `accessToken || apiKey`, and the base URL is the connection's. The poll URL must be on the same origin as the submit URL.
  - `pollOcrOperation`: 30 attempts 1000 ms apart, with the same key header and redirects refused. `succeeded` returns the answer, `failed` returns 502, and running out of attempts returns 504.
- `src/app/api/v1/ocr/route.ts` `resolveOcrCredentials`: the endpoint is the top-level `baseUrl`, else `providerSpecificData.baseUrl`.

## Local equivalence

- `git ls-files | rg -i 'ocr'`: only the staged foundation, its test and report, plus the unrelated `open-sse/utils/kiroCreateResponse.js` and `tests/unit/port-10400-chutes-ocr-seed.test.js`.
- `git ls-files | rg -i 'azure'`: Azure OpenAI chat providers only. There is no Document Intelligence executor, registry entry or validator.

Result: DurinDoor has no Azure Document Intelligence path. This module is the provider delta on top of the foundation.

## What is staged

`azureDocumentIntelligenceOcrSpec({ endpoint })` returns a plain adapter spec. The foundation's `defineOcrAdapter` takes it, and its `createOcrDispatcher` runs it. The module imports no dispatch code. Two reasons:

- The Azure endpoint is per connection, so a spec is built for one configured endpoint. Its origin is the only target for the submit and every poll.
- The foundation's staging test requires that no file under `open-sse/` outside the foundation names it. That test is outside this unit's paths. The registration step does the wiring in `open-sse/handlers/ocrCore.js`.

Other exports: `azureDocumentIntelligenceEndpoint(credentials)`, `azureDocumentIntelligenceOrigin(value)`, `azureDocumentIntelligenceAnalyzeUrl`, `azureDocumentIntelligenceSource`, `azureDocumentIntelligencePollState`, `parseAzureDocumentIntelligenceResult`, and the `AZURE_DI_*` constants. `registration.json` lists each one.

## Supported subset

- Model: `prebuilt-read` only, as `prebuilt-read` or `azure-document-intelligence/prebuilt-read`.
- Documents: `document_url` or `image_url` (a string or `{ url }`) as a public https URL, sent as `urlSource`. A base64 data URL of PDF, PNG, JPEG or TIFF, sent as `base64Source`.
- Request fields: `model` and `document` only.
- Auth: `credentials.apiKey` as `Ocp-Apim-Subscription-Key` on the submit and every poll.
- Endpoint: `credentials.baseUrl`, else `credentials.providerSpecificData.baseUrl`.
- Result: `{ model, pages: [{ index: 0, markdown }], usage_info?: { pages_processed } }`.

## Intentional contract changes

- Endpoint: a bare https origin on `*.cognitiveservices.azure.com`, `*.cognitiveservices.azure.us`, `*.cognitiveservices.azure.cn` or `*.api.cognitive.microsoft.com`, with a single resource label, no path, query, fragment, userinfo or port, and not a blocked host. The source sends the key to any configured base URL. Private endpoints behind custom domains are therefore not supported yet.
- Selected credentials: the key is sent only when the selected connection's own endpoint equals the endpoint the adapter was built for. Otherwise the request gets a 401 before anything is sent.
- `accessToken` is never sent as the subscription key. The source sends `accessToken || apiKey`.
- Only `prebuilt-read` is accepted. The source passes any prefixed id through, then labels its answer `prebuilt-read` anyway.
- The reported model is the requested model, not a hardcoded string.
- Polling:
  - The submit must answer 202 with an `Operation-Location` on the endpoint origin of the form `/documentintelligence/documentModels/{model}/analyzeResults/{id}`. Anything else is a lost accepted job and is never read as a synchronous answer.
  - `notStarted` and `running` keep polling, `failed` and `canceled` fail, and any other state is a lost result.
- A succeeded answer without string `analyzeResult.content` is a lost result, not an empty page.
- When `analyzeResult.pages` is missing, `pages_processed` is omitted and the foundation counts the returned page (1), the same number the source defaults to.
- Inline WebP and GIF are refused before sending. The foundation accepts them, but the Read model does not.

The foundation adds the following: no default model, public https document URLs only (SSRF guard), bounded inline documents, one deadline for the submit and every poll, refused redirects, bounded bodies, upstream text never quoted, status-mapped refusals (402 `quotaExhausted`, 429 and 503 `Retry-After`), and `acceptedJob` with no replay whenever Azure may have done the work.

## Not ported

- Mistral and Vertex DeepSeek OCR, which are separate units. The retired managed Vertex model is not referenced.
- Per-page splitting of `content`. The source returns one aggregated page.
- Other Document Intelligence models (layout, custom), the `pages`/`locale`/`features` query options, and `Retry-After` on status checks. Polling uses the foundation's fixed schedule, as in the source.

## Tests

`tests/unit/native-ocr-azure-document-intelligence.test.js` (106 cases) uses closed mocks only. The injected transport fails on any unexpected request. The endpoints are synthetic Azure-shaped hosts, and every key is synthetic. It wires the spec through the real foundation (`defineOcrAdapter` and `createOcrDispatcher`). The tests cover:

- Endpoint parsing and connection resolution.
- The exact submit URL, method, headers and body.
- The poll URL and headers.
- The payload, page and usage mapping, and accounting.
- Inline media mapping.
- Model, field, document and SSRF refusals.
- Selected-credential binding.
- Refusal and quota mapping with no leaks.
- Redirects, transport errors, polling failures and running out of attempts.
- Deadlines and aborts, with no submit ever replayed.

The unregistered-state assertions are kept in one final `staging:` block. That block is the only part that registration may promote.

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-ocr-azure-document-intelligence.test.js --maxWorkers=2
```

## Registration (serial, not done here)

1. In the foundation's `open-sse/handlers/ocrCore.js`, for an `azure-document-intelligence` connection: resolve `azureDocumentIntelligenceEndpoint(credentials)`, refuse locally when it is null, then `defineOcrAdapter(azureDocumentIntelligenceOcrSpec({ endpoint }))` and dispatch with the same credentials. Cache the adapter per endpoint.
2. Register the provider with an endpoint field stored as `providerSpecificData.baseUrl`.
3. List `azure-document-intelligence/prebuilt-read` under `/v1/ocr` in `docs/providers/catalog.mdx`.
