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

## CI gate (zero-failure)

The recovery baseline is empty. CI requires direct Vitest success and treats
any raw failure as a regression; `__baseline__/known-fails.txt` must remain
empty. Bug-exposure tests that intentionally use `it.fails` remain governed by
the translator convention in `AGENTS.md` and are not baseline exceptions.

```bash
cd tests
npm run test:ci    # runs the suite (JSON) then the no-regression gate
```

`test:ci` fails closed on startup, collection, runtime, stale-report, and parse
errors. It deletes old reports first, writes `.test-results.json` and
`.test-results.junit.xml`, and reports raw failures, known failures, and stale
baseline entries separately; all three counts must be zero. This is what
`.github/workflows/test.yml`, Nightly, and release workflows run and upload on
every attempt.

Use Node `20.20.2` and npm `10.8.2`. For an unwrapped raw run, use `npm test`;
for the authoritative report-producing gate, use `npm run test:ci`. Build and
test commands must point `HOME` and `DATA_DIR` at disposable directories so
they cannot read or migrate an operator database.

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
