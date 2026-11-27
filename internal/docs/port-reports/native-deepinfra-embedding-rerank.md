# DeepInfra native embeddings and rerank — #2034

Private, unregistered staging for Decision15. No production imports, provider registry,
shared catalog, connection modes or public handler changes. Serial registration follows
four additions; machine-readable handoff is in
`open-sse/services/providerParity/native-deepinfra-embedding-rerank/registration.json`.

## Source and dispatch evidence

Read-only `/tmp/omni-2034` HEAD verified as
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` (OmniRoute, MIT).
Source attribution:

- `open-sse/config/embeddingRegistry.ts`: enabled `deepinfra` entry, eight models
  including dimensions; apikey/bearer, `https://api.deepinfra.com/v1/openai/embeddings`.
- `open-sse/handlers/embeddings.ts`: `buildUpstreamBody` sends model/input,
  optional dimensions/encoding_format; standard OpenAI list/vector response.
- `open-sse/config/rerankRegistry.ts`: enabled `deepinfra` entry, three Qwen3
  reranker models; apikey/bearer, format `deepinfra`, `/v1/inference`.
- `open-sse/handlers/rerank.ts`: `adaptRerankRequest` sends queries:[query] and
  document strings, appends model to inference URL; `adaptRerankResponse` maps
  positional scores, sorts descending, applies top_n and return_documents locally.
- `open-sse/config/providers/registry/deepinfra/index.ts` and
  `src/app/api/providers/[id]/models/discovery/providerSets.ts` plus `helpers.ts`:
  canonical ID and alias both `deepinfra`; named OpenAI discovery with bearer token.

Fetched `origin/main` on 2026-11-27; resulting main SHA
`f14f877ec13d6a9c58ed5a7d8f665526f748e76e`. Starting local HEAD
`e21aebed85f7163a2b4c1f8bc94873bee15a2d06`.
Checked both local and fetched-main dispatch/config, not merely provider names:

- `handlers/embeddingProviders/index.js`: DeepInfra absent from
  `EMBEDDING_ADAPTERS`; generic factory has no DeepInfra embeddingConfig either.
- `providers/registry/deepinfra.js`: existing apikey provider with bearer chat URL
  `/v1/openai/chat/completions`, alias `deepinfra`. Preserve it, do not duplicate it.
- `handlers/rerankCore.js`: `deriveRerankUrl` actually **can** derive
  `/v1/openai/rerank` from the chat URL. This corrects the initial inventory's
  “no derivable local rerank config” description. That endpoint and passthrough
  `{model,query,documents,top_n,...}` envelope are not the pinned inference
  endpoint or native envelope. Native serialization/normalization is still missing.
- Existing DeepInfra `modelsFetcher` already uses `/v1/openai/models`, type
  `openai`, with passthrough models. This is the discovery equivalent; no second
  production discovery registration is needed. Staged discovery tests enforce safe
  IDs, bounded transport, auth isolation and known-vs-unknown capabilities.

CodeGraph query was attempted, but its wrapper reported “CodeGraph 1.6.2 required.”
Used bounded checkout-only rg/git reads instead. No agents or live provider calls.

## Supported subset and contracts

Exports include immutable source catalogs/configs, native adapter builders,
normalizers, `handleDeepinfraNative` and `discoverDeepinfraModels`.
`handleDeepinfraNative` accepts the existing core's body/modelInfo/credentials/signal
shape plus kind (`embedding` or `rerank`), optional bounded timeout and injectable
transport. Returns success/status/Response/accounting, or the existing error result
with acceptedJob when submitted work may have billed. Connection identity is kept in
internal accounting; credentials are neither mutated nor cached across calls.

Text embeddings accept one nonempty string or up to 2048 strings, each at most
20,000 characters, safe optional positive integer dimensions, and float encoding.
Unlike upstream truncation, overlong text is refused before submission. No token
arrays, structured/media inputs, base64, streaming or arbitrary extra fields.
The source supports more OpenAI pass-through fields/encoding; these remain outside
this staged subset. Vectors must be finite, nonempty, dimension-consistent, with
exact input count and unique in-range indices. Rows are returned in index order.

Rerank accepts nonempty query, up to 2048 text documents (strings or `{text}`),
validated top_n and return_documents. It submits exactly `{queries,documents}`;
model appears only in the inference path. Requires exactly one finite score per
document. Stable descending sorting, top_n and document inclusion happen locally.
No synthetic billed_units/search_units are reported: the source's hardcoded value
is not provider evidence. Unknown cost remains null/unknown. Only reported numeric
token/USD receipt fields enter accounting, including unusable completed responses;
undocumented `inference_status.cost` is not interpreted as USD.

Custom organization/model IDs are accepted without implying a model supports either
service. IDs allow exactly two safe path segments; schemes, traversal, escapes,
query strings and fragments are refused. Discovery is a strict bounded read of the
OpenAI-style data array, with no credential cache. It returns only IDs and serviceKinds
known from the pinned catalogs; unknown IDs get an empty capability list. Unsafe
IDs fail the whole catalog. It does not replace the existing production catalog's
fallback policy and does not infer capabilities from names or remote URLs.

Transport uses local proxyAwareFetch with the selected connection's proxy options;
apiKey then accessToken bearer precedence matches existing embedding auth. Missing
or header-unsafe keys fail before network. Fixed HTTPS origin/endpoints and manual
redirect refusal prevent credential forwarding. Foreign/redirected responses are
refused; no output URLs are fetched or returned. There are no artifacts, polling,
WebSockets, sockets outside fetch, or browser contracts for these synchronous APIs.
Arbitrary upstream fields/bodies/parser errors are never relayed.

One submission only: no automatic retry, refresh, replay or failover. Default total
call deadline 30 seconds, maximum 60 seconds, covering headers and body together;
8 MiB success/16 KiB error read limits. Abort/deadline ends waits and aborts fetch
and body reader even when mocks ignore signals; late responses are discarded.
Pre-send cancellation/proven connection failure is not accepted work. Uncertain
network/5xx or completed unread/unusable answers carry acceptedJob, honest unknown
cost, and selected connection identity. Quota exhaustion applies only to the selected
credential; 429 Retry-After uses existing rate-limit evidence. 401/403 never trigger
credential mutation or another billable submit.

## Registration handoff

`registration.json` records exact exports, IDs/alias, models, endpoints/auth and
public handler integration points. Register embedding identity and media metadata
later. The strict adapter normalizer takes `(raw, model, body)`; the existing generic
embedding core invokes `normalize(raw)`, so registration must supply that context
and use the bounded service rather than blindly adding a factory entry. Rerank needs
explicit native dispatch before the generic URL/passthrough path. Preserve the existing
provider definition, chat/OAuth/cookie connection behavior, and dynamic modelsFetcher.
No public behavior is activated by this patch. The test file's isolated staging block
alone checks unregistered state; all protocol/security/accounting assertions work
independently of registration.

## Focused evidence

Dependencies installed in root, cli and tests with frozen lockfiles/prefer-offline.
Focused command (no full suite requested):

```sh
cd tests && test -f unit/native-deepinfra-embedding-rerank.test.js && node node_modules/vitest/vitest.mjs run unit/native-deepinfra-embedding-rerank.test.js --maxWorkers=2
```

Scoped lint:

```sh
pnpm exec eslint open-sse/services/providerParity/native-deepinfra-embedding-rerank/*.js tests/unit/native-deepinfra-embedding-rerank.test.js
```

Result: 71 focused tests passed; scoped ESLint passed with no findings.

Closed mocks cover wire bodies/headers, source catalog identity, native sorting and
vectors, supported/custom models, two credentials, failure/quota, numeric receipts,
unknown accounting, abort before/during submit and body read, total deadline,
uncertain submission/no replay, malformed/oversized/unsafe outputs and discovery.
No baseline changes. No live accounts, paid APIs, browser, Docker, deploy or full CI.
