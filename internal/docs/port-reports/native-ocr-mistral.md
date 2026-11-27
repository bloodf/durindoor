# Mistral native OCR (staged), 2026-11-27

Issue #2034. This adapter is staged and not registered. Nothing in production imports `open-sse/services/providerParity/native-ocr-mistral/`. It is the first provider adapter on the staged OCR foundation (`open-sse/services/providerParity/native-ocr-foundation/`), and it does not change that foundation.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). The files were read with public GETs at that commit.

- `open-sse/config/ocrRegistry.ts` (sha256 `eaf03785…d7b169`):
  - The `OCR_PROVIDERS.mistral` entry has `id: "mistral"`, `baseUrl: "https://api.mistral.ai/v1/ocr"`, `authType: "apikey"` and `authHeader: "bearer"`. Its models are `mistral-ocr-latest` ("Mistral OCR") and `mistral-ocr-2512` ("Mistral OCR 3"). It has no `transformation`.
  - `getOcrTransformation` falls back to `MISTRAL_PASSTHROUGH`. That builder sends `POST baseUrl` with `Content-Type: application/json` and `Authorization: Bearer <token>`, and its body is `JSON.stringify({ ...clientBody, model: modelId })`. `parseResponse` returns the answer unchanged, and there is no `pollUrl`.
  - `parseOcrModel` falls back from the `mistral-ocr-` prefix to `mistral`.
- `open-sse/handlers/ocr.ts` (sha256 `f55ccda0…d5ad703`): in `handleOcr`, the model defaults to `mistral-ocr-latest`, the token is `accessToken || apiKey`, and `credentials.baseUrl` overrides the registry URL.

The Azure Document Intelligence and Vertex DeepSeek entries are separate units and are not ported here. The retired managed `deepseek-ocr-maas` model is not mentioned in this adapter except as a refused id in tests.

## Vendor contract (verified 2026-11-27)

These were read with public GETs only. Where the vendor contract and the source differ, the vendor contract wins.

- `https://docs.mistral.ai/openapi.yaml` (sha256 `acf0efcbee4617601df77fc40185516ed6aae4369ce090034099317d5866b2db`, the same digest the staged Mistral STT unit pinned) documents operation `ocr_v1_ocr_post`, `POST /v1/ocr`:
  - `OCRRequest` (JSON, `additionalProperties: false`) requires `model` and `document`.
    - `document` is a `FileChunk` (`file_id`), a `DocumentURLChunk` (`document_url`, optional `document_name`) or an `ImageURLChunk` (`image_url` as a string or `{ url, detail? }`).
    - The optional fields are `pages`, `include_image_base64`, `image_limit`, `image_min_size`, `bbox_annotation_format`, `document_annotation_format`, `document_annotation_prompt`, `table_format`, `extract_header`, `extract_footer`, `include_blocks` and `confidence_scores_granularity`.
    - `pages` is an integer list or a string of indexes and ranges such as `"0,2-4"`. Pages start from 0.
  - `OCRResponse` requires `pages`, `model` and `usage_info`.
    - Each page has `index` (minimum 0), `markdown`, `images` and `dimensions`, plus optional tables, hyperlinks, header, footer, confidence scores and blocks.
    - The response may also carry `document_annotation`.
    - `usage_info` has `pages_processed` and an optional `doc_size_bytes`.
  - The only documented error is `422 HTTPValidationError`.
- `https://docs.mistral.ai/getting-started/models/models_overview/` (sha256 `1f764d4e7755a688d06dc5f1a9e01a1b27af807977884f83e5c1b634fd9e3807`):
  - OCR 4.1 has the ids `mistral-ocr-4-1`, `mistral-ocr-4` and `mistral-ocr-latest`. OCR 3 has `mistral-ocr-2512`.
  - Retired models: `mistral-ocr-4-0` on 2026-09-30, `mistral-ocr-2505` on 2026-05-31 and `mistral-ocr-2503` on 2025-12-31.
- `https://docs.mistral.ai/studio/document-processing/basic-ocr` (sha256 `a9834d91bc1554d2d6269a164dde814d06d55bfd4c456cb5698018aefb8bdfe1`):
  - PDF data URLs go in `document_url` and images in `image_url`. PNG, JPEG, WebP, GIF and TIFF are among the supported formats.
  - `table_format` set to `markdown` or `html` returns tables separately. `extract_header` and `extract_footer` move that text out of the page content.
  - Documents are limited to 50 MB and 1,000 pages.

## Local equivalence

- `open-sse/providers/registry/mistral.js` has the `llm`, `imageToText` and `embedding` kinds. It has no OCR config and no `mistral-ocr` model rows.
- Outside `internal/docs`, `git grep -n -i "mistral-ocr\|/v1/ocr"` finds only the staged foundation's comments and registration notes.
- There is no OCR core or `/v1/ocr` route.

Result: DurinDoor has no Mistral OCR path. This adapter is the delta on top of the foundation.

## What is staged

- `mistralOcrAdapter` and `createMistralOcrAdapter()` build a frozen `defineOcrAdapter` result with these properties:
  - Origin: `https://api.mistral.ai` only.
  - Models: four static rows and no passthrough.
  - Document types: `document_url` and `image_url`.
  - Inline media types: the foundation defaults (PDF, PNG, JPEG, WebP, GIF, TIFF), all of which the vendor guide lists.
  - Options: `pages`, `image_limit` and `image_min_size`.
  - No poll.
- `buildMistralOcrRequest`, `parseMistralOcrResponse`, `mistralOcrAuthHeaders`, `mistralOcrDocument` and `validateMistralOcrPages` are the adapter pieces, exported for tests and registration.
- `createMistralOcrDispatcher(options)` is a foundation dispatcher that serves only this adapter. It is used by the tests.
- `registration.json` holds the source and vendor attribution with digests, the supported subset, the export list and the integration points.

### Supported subset

| Vendor field | Gateway |
| --- | --- |
| `model` | Required. The four listed ids, bare or with the `mistral/` prefix. |
| `document.document_url` | A public https URL or a base64 PDF/image data URL. |
| `document.image_url` | A public https URL or a base64 image data URL, as a string or `{ url }`. It is sent as a string. |
| `pages` | 1–1,000 non-negative indexes, or an ascending range string of at most 1,024 characters. |
| `image_limit`, `image_min_size` | Non-negative integers. |
| `table_format`, `extract_header`, `extract_footer` | Refused, because they move content out of `markdown` and the normalized answer keeps only `markdown`. |
| `include_image_base64`, `include_blocks`, `confidence_scores_granularity` | Refused, because their output would be dropped. |
| `bbox_annotation_format`, `document_annotation_format`, `document_annotation_prompt` | Refused, because annotated pages are billed at a higher rate and `document_annotation` would be dropped. |
| `document_name`, `image_url.detail`, `file_id` | Refused by the foundation's document validation. |

A `null` optional field is treated as absent.

## Intentional contract changes

- Only the declared fields are forwarded. The source spreads the whole client body.
- The document is rebuilt from the foundation's normalized form. A URL fragment is dropped, and the inline bytes are never echoed back in the result.
- The API key wins over an access token. The source uses `accessToken || apiKey`. This matches the staged Mistral STT adapter and the apikey-only `mistral` connection.
- A blank token, or a token containing whitespace, is refused with 401 before anything is sent.
- Connection base URLs are ignored, so the key goes only to `https://api.mistral.ai/v1/ocr`.
- The model list follows the vendor overview. `mistral-ocr-4-1` and `mistral-ocr-4` are added, and `mistral-ocr-latest` is named "Mistral OCR 4.1". There is no default model and no `mistral-ocr-` prefix fallback, so the retired `mistral-ocr-2503`, `mistral-ocr-2505` and `mistral-ocr-4-0` are refused locally.
- The answer keeps only `model`, `pages[].index`, `pages[].markdown` and primitive `usage_info` values. `doc_size_bytes: null` is dropped, and `document_annotation`, images and blocks are dropped. Pages are sorted by index.
- The foundation's transport rules apply:
  - One 300 s deadline covers the request, and a successful answer is capped at 32 MiB.
  - Redirects are refused, and nothing is retried.
  - Upstream text is never quoted.
  - A 402 is flagged `quotaExhausted`.
  - A 429 or 503 keeps usable `Retry-After` evidence.
  - Other 5xx statuses, redirects, sent transport errors, aborts after the send and deadlines carry `acceptedJob` and are never replayed.

## Tests

`tests/unit/native-ocr-mistral.test.js` uses closed mocks only, with synthetic keys and an injected transport that throws on any unexpected request. It covers the following:

- The adapter definition, its frozen shape, and use in a shared dispatcher.
- The exact wire: URL, method, headers, body field order and each document chunk form. It also checks that no poll happens, even when an `Operation-Location` header is present, and that proxy options are passed through.
- Models: every listed id, bare and prefixed, is accepted. Retired, foreign, unknown and unsafe ids are refused locally.
- Auth: which credential is selected, the refusal cases, per-connection keys, and base URLs being ignored.
- URL and data-URL safety, refused vendor fields, and the `pages`, `image_limit` and `image_min_size` validators.
- Response normalization, `pages_processed` and returned-pages accounting, and malformed, non-JSON and oversized answers.
- Each refusal status, quota and rate-limit evidence, redirects, unsent and uncertain transport failures, aborts before and after the send, and the deadline during the send and during the body read.

The staging block is the last `describe`. Its assertions depend on the unregistered state:

- `registration.json` status and exports.
- No production importer.
- `providers/registry/mistral.js` has no OCR rows.

At registration, this block becomes positive identity checks.

Evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/native-ocr-mistral.test.js --maxWorkers=2` (118 passed). The foundation suite still passes (92 passed).

## Registration (serial, not done here)

- Add `mistralOcrAdapter` to the OCR core's adapter list (`open-sse/handlers/ocrCore.js`, from the foundation's registration).
- In `open-sse/providers/registry/mistral.js`, add `"ocr"` to `serviceKinds` and add the `MISTRAL_OCR_MODELS` rows with kind `ocr`. Keep the existing kinds and the apikey auth mode.
- List the Mistral `ocr` kind in `docs/providers/catalog.mdx`.
