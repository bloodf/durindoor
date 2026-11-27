# Native vertex-deepseek-ocr OCR adapter (staged), 2026-11-27

Issue #2034. This module is staged and not registered. Nothing in production imports `open-sse/services/providerParity/native-ocr-vertex-deepseek-ocr/`, and DurinDoor still has no `/v1/ocr` route. It is the Vertex DeepSeek-OCR provider half on top of the staged OCR foundation (`native-ocr-foundation`). The Mistral and Azure Document Intelligence entries are separate units.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT), read from the local object store with `git show`.

- `open-sse/config/ocrRegistry.ts`
  - `OCR_PROVIDERS["vertex-deepseek-ocr"]`: `baseUrl: ""`, `authHeader: "bearer"`, `models: []`, transformation `VERTEX_DEEPSEEK_TRANSFORMATION`.
  - `VERTEX_DEEPSEEK_TRANSFORMATION.buildRequest`: `POST <baseUrl>` with `Content-Type: application/json` and `Authorization: Bearer <token>`. The body is `{ model: modelId, messages: [{ role: "user", content: [{ type: "image_url", image_url: <document_url ?? image_url> }] }] }`. The `image_url` value is the plain URL string, not `{ url }`.
  - `parseResponse`: reads `choices[0].message.content`. A string that starts with `{` and parses to an object with a `pages` array is used as `{ pages, model: parsed.model ?? model, usage_info: parsed.usage_info ?? usage }`. Any other string becomes one page `{ index: 0, markdown: content }`. Non-string content becomes one empty page. `model` falls back to `"vertex-deepseek-ocr"`.
  - `VERTEX_DEEPSEEK_RETIRED_MODEL_ID = "deepseek-ocr-maas"`. Google retired the managed model on 2026-10-21 (#20423).
- `open-sse/handlers/ocr.ts`
  - `resolveVertexOcrBaseUrl`: `https://aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi/chat/completions`. The project comes from `providerSpecificData.project`, then the Service Account `project_id`. The region comes from `providerSpecificData.region` and defaults to `us-central1`.
  - `resolveVertexOcrAccessToken`: an existing `accessToken` wins. A Service Account JSON `apiKey` mints a token. A raw `apiKey` is used as an access token.
  - `handleOcr`: refuses `vertex-deepseek-ocr/deepseek-ocr-maas` with a 400 before anything is sent.
- `src/app/api/v1/ocr/route.ts` (context only): `credentials.baseUrl` or `providerSpecificData.baseUrl` overrides the built URL.

## Local equivalence

- `git ls-files | rg -i ocr` finds only the staged foundation, `open-sse/utils/kiroCreateResponse.js` (unrelated), and a chat-model seed test.
- This fork's Vertex credential handling lives in `open-sse/services/tokenRefresh.js` (`classifyVertexCredential`, `refreshVertexToken`, `refreshGoogleToken`). The staged Vertex video unit (`native-vertex-video/auth.js`) uses the same functions. This unit reuses them and adds no new OAuth flow.

## What is staged

- `createVertexDeepseekOcrAdapter({ project, region, token })` defines one foundation adapter per selected connection. Its only origin is `https://aiplatform.googleapis.com`. It has no static models, a passthrough `acceptsModel`, image-only inline media, no options and no polling.
- `buildVertexDeepseekOcrBody` and `parseVertexDeepseekOcrResponse` follow the source transformation.
- `vertexDeepseekOcrScope(credentials)` resolves the project, region and credential kind without any network call. `resolveVertexOcrToken(scope, …)` returns the Bearer token and mints one when needed, within a bound.
- `runVertexDeepseekOcr({ body, credentials, signal, … })` handles one request on the selected connection. The steps run in this order:
  1. Refuse the retired model.
  2. Resolve the scope.
  3. Validate the request with the foundation.
  4. Mint the token.
  5. Dispatch once through `createOcrDispatcher`.
- `registration.json` records the source attribution, the ported and not-ported items, the supported subset, the intentional contract changes, the exports, the failure contract and the integration points.

## Supported subset

- Endpoint: `POST https://aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi/chat/completions`.
- Auth: `Authorization: Bearer <token>`. The token comes from the connection `accessToken`, from a Service Account or `authorized_user` ADC file, or from a raw `apiKey`.
- Project: `providerSpecificData.project` (source spelling) or `.projectId` (fork spelling), then the Service Account `project_id`, then the ADC `quota_project_id`.
- Region: `providerSpecificData.region` (source spelling) or `.location` (fork spelling). The default is `us-central1`.
- Models: any deployed model id the caller names, optionally prefixed with `vertex-deepseek-ocr/`. The id is sent as supplied.
- Documents: `document_url` or `image_url`, either a public https URL or a base64 image data URL (PNG, JPEG, WebP, GIF or TIFF).

## Intentional contract changes

- A configured base URL (`credentials.baseUrl` or `providerSpecificData.baseUrl`, used for dedicated Model Garden endpoints) is refused with a local 400, not followed. This keeps the token on the Vertex origin. Dedicated endpoints can be added later behind an explicit host allowlist.
- The project and region are built into the URL path, so they must be plain Google Cloud ids. `global` and path-shaped values are refused. If both the source and fork spellings are set and they differ, the request is refused.
- A JSON credential that is neither a Service Account nor an `authorized_user` file is refused and never sent as a raw token. ADC files mint tokens, as in this fork's other Vertex paths.
- The retired id is refused in every form, case-insensitively: bare, provider-prefixed or publisher-qualified (`deepseek-ai/deepseek-ocr-maas`). The source checked only the exact bare id after the prefix.
- The request is validated and the connection resolved before any token is minted. Minting is bounded (15 s by default, and never longer than the whole request budget) and the caller can abort it. Minting failures are local and carry no `acceptedJob`.
- Inline documents must be images, because they travel as an `image_url` part. `gs://` URLs are refused, because the foundation accepts only public https URLs and bounded data URLs.
- Top-level fields other than `model` and `document` are refused. The source silently dropped them.
- An answer with no `choices`, or with non-string content, is a lost result (502 with `acceptedJob: accepted`). The source returned an empty page in that case. Embedded JSON pages must pass the foundation's page validation.
- When the answer names no model, the requested deployed id is reported, not the provider id.

## Inherited from the foundation

The foundation provides the following:

- One deadline for the whole request.
- Redirects are refused.
- Response bodies are capped at 32 MiB and error bodies at 16 KiB.
- Upstream text is never quoted, and tokens and keys are redacted. The minted token is passed as `accessToken` so the sanitizer knows it.
- Refusals are mapped by status: 401 and 403 keep their status, 402 is flagged `quotaExhausted`, 429 and 503 keep `Retry-After` evidence, and other 5xx statuses become 502 with `submit-unknown`.
- Pre-connect transport errors carry no `acceptedJob`. Any failure after the document was sent carries one and must not be replayed on this or another connection.
- Accounting counts `usage_info.pages_processed` or the returned pages, and the cost stays unknown.

## Not ported

- Dedicated endpoint base URLs and `gs://` documents (see above).
- The `/v1/ocr` route, account selection, rate-limit gates, OmniRoute meta headers and request ids. These are registration and integration work.
- The Mistral and Azure Document Intelligence entries, which are separate units.

## Tests

`tests/unit/native-ocr-vertex-deepseek-ocr.test.js` has 80 cases and uses closed mocks only. The injected transport fails on any unexpected request, token minting is an injected fake, and every credential is synthetic. The cases cover the following:

- Protocol: the exact URL, method, `redirect: "manual"`, Bearer header and source body for `document_url`, `image_url`, `{ url }` and inline images. Also prefix stripping, no built-in model, and a status header that never triggers a poll.
- Retired model: five spellings are refused before any mint or send.
- Safety: http, `gs://`, loopback, metadata, localhost, userinfo and over-long URLs; inline PDF and non-base64 data URLs; unknown fields; unsafe model ids. None of them mint a token or send anything.
- Scope: source and fork spellings, conflicts, Service Account and ADC projects, malformed project or region, `global`, configured base URLs, missing or unsupported credentials, and malformed tokens.
- Credentials: precedence (access token, then minted token, then raw key); minting from a Service Account and from ADC; the proxy is passed to both the minter and the transport; validation before minting; minting errors, an empty or malformed token, a timeout, an abort, and the whole-budget bound. Two connections never share a token or project.
- Answers: JSON pages are sorted and their usage filtered; usage falls back to the chat usage; non-JSON content becomes markdown; page accounting. Missing choices, array or null content, bad embedded pages, non-JSON and oversized answers are lost results with `acceptedJob`.
- Errors and quota: 400, 401, 403 and 404 are passed through; 402 sets `quotaExhausted`; 429 keeps `Retry-After`; 500, 503 and 504 are `submit-unknown`; redirects are refused; pre-connect and mid-flight transport errors are told apart. Each case sends once, and no upstream text or secret is leaked.
- Abort and deadline: an abort before the send is local; an abort after the send and a deadline timeout are `submit-unknown`.
- Staging block (isolated): the registration identity, the export list, and that no production file imports the module.

Evidence: `cd tests && node node_modules/vitest/vitest.mjs run unit/native-ocr-vertex-deepseek-ocr.test.js --maxWorkers=2` passes 80 of 80.

## Registration notes

- The foundation staging guard permits only the Vertex `adapter.js`, `ocr.js`, and `registration.json` foundation references. It also scans production roots for references to the Vertex sibling, preventing a production entry through that private adapter. No directory-wide providerParity exception is granted.
- Registration wires `runVertexDeepseekOcr` into the new OCR core for provider `vertex-deepseek-ocr`. It must stop account fallback on `local` or `acceptedJob`, declare the provider's credential fields (`project`, `region`) in the registry, and document `/v1/ocr` in the catalog.

## Retry validation

Carried forward candidate `865f31fb7ec2e38c38b02c2f8a563010659ad641`
(the original adapter commit is `6a32e578ee0302ccbcb70465d84bf2b763a01e11`).
All seven adapter files and the complete 80-case test file are unchanged from
that candidate, including its imperative dispatcher-options lint fix. No
tracked gate metadata is present in this checkout; the candidate was located
in the existing attempt branch history.

Validation on this retry:

- Scoped ESLint over the adapter JavaScript and its test: exit 0.
- `pnpm run lint:anti-slop`: exit 0, zero diagnostics across 3627 files.
- Required focused Vitest command: 80/80 passed.
- Combined foundation and adapter Vitest run with two workers: 171/172 passed.
  The sole failure is `native-ocr-foundation.test.js:610`, staging assertion
  `is imported by nothing in production`. Its broad `git grep` includes the
  staged adapter's imports in `adapter.js` and `ocr.js`. The foundation test
  is explicitly outside this unit's allowed paths. No production wiring was
  added, no tests were removed or weakened, and no baseline was changed.

The enclosing gate therefore still needs the foundation staging assertion
resolved in its owning unit before it can pass with staged sibling adapters.


## Authorized boundary retry (ec498763)

Restored the implementation and all 80 adapter cases byte-for-byte from
`ec49876377247cd9fda238f1a9285151758265de`, as specified by the retry metadata.
Only the isolated foundation staging assertion changed; all 92 foundation
cases remain. No protocol, authentication, security, or usage assertion changed.

Validation:

- Scoped ESLint and repository anti-slop lint passed.
- Combined focused run: 171/172 passed (80 Vertex cases, 92 foundation cases).
- Remaining failure: the staging guard detects existing foundation references in
  `native-ocr-mistral/adapter.js`, `config.js`, and `registration.json` in this
  integration checkout. The authorization permits only Vertex exceptions, so
  these Mistral references remain rejected; no broader allowance was added.
- Mutation evidence: temporarily staged a production file at
  `open-sse/handlers/ocr-staging-boundary-probe.js` importing the foundation
  directly, then importing the permitted Vertex sibling. Each focused guard
  run failed and explicitly included the probe path in its rejected consumers.
  The probe was removed from both the index and working tree afterward.

No public wiring or registration was introduced. The enclosing gate remains
blocked by the separate Mistral staging consumer policy.
