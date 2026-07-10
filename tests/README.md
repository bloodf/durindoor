# DurinDoor Test Suite

Vitest suite covering the open-sse handlers, translator, provider executors, DB
layer, and security audits (plus the original `/v1/embeddings` unit tests).

## Setup

Vitest is a local dev dependency of this `tests/` package — no global install and
no `/tmp` workarounds. From the repo root, make sure app dependencies are
installed, then install the test dependencies:

```bash
npm ci                  # repo root — installs open-sse/src deps + better-sqlite3
cd tests && npm ci      # installs the locked Vitest dependency graph
```

## Running Tests

```bash
cd tests
npm test           # full suite, verbose reporter
npm run test:watch # watch mode
```

## CI gate (no-regression)

During Stage 1 recovery, CI tolerates only the curated failures in
`__baseline__/known-fails.txt`. The runner fails closed on startup, collection,
runtime, stale-report, and parse errors, and rejects any new baseline entry.

```bash
cd tests
npm run test:ci    # runs the suite (JSON) then the no-regression gate
```

`test:ci` deletes old reports first, writes `.test-results.json` and
`.test-results.junit.xml`, and reports raw failures, known failures, and stale
baseline entries separately. This is what `.github/workflows/test.yml` runs and
uploads on every attempt.

## Test Files

| File | What it tests |
|------|--------------|
| `unit/embeddingsCore.test.js` | `open-sse/handlers/embeddingsCore.js` — core logic: body builder, URL router, headers, handler flow |
| `unit/embeddings.cloud.test.js` | `cloud/src/handlers/embeddings.js` — cloud worker handler: auth, validation, rate limits, CORS |

## Coverage Summary (59 tests)

### `embeddingsCore.test.js` (36 tests)
- `buildEmbeddingsBody`: single string, array, encoding_format, default float
- `buildEmbeddingsUrl`: openai, openrouter, openai-compatible-*, unsupported providers
- `buildEmbeddingsHeaders`: per-provider header sets, fallback to accessToken
- `handleEmbeddingsCore` input validation: missing, wrong type, null, empty
- `handleEmbeddingsCore` success: response format, CORS, Content-Type, callbacks
- `handleEmbeddingsCore` errors: 400/429/500, network error, invalid JSON
- `handleEmbeddingsCore` token refresh: 401 retry, graceful fallback

### `embeddings.cloud.test.js` (23 tests)
- CORS OPTIONS: 200 response, empty body, correct headers
- Authentication: missing key, bad format, old-format key, wrong key value, valid key
- Body validation: invalid JSON, missing model, missing input, bad model
- Happy path: single string, array, correct delegation, CORS header, machineId override
- Rate limiting: all accounts rate-limited → 503 + Retry-After, no credentials → 400
- Error propagation: non-fallback errors passed through, 429 exhausts accounts
- machineId override: validates key, rejects wrong key
