# Native Bedrock embeddings (#2034)

Private staged port of OmniRoute (MIT), pinned and verified at
`c71f0065a7efe9230ec23b96a12253b050c4d7ad` in `/tmp/omni-2034`.
Source contracts: `open-sse/config/embeddingRegistry.ts:126`,
`open-sse/handlers/embeddings.ts` (prepareBedrockTransport and
fetchBedrockEmbeddingBatch), `open-sse/handlers/bedrockEmbeddings.ts`,
`open-sse/config/bedrock.ts`, `open-sse/services/bedrock.ts`.

## Reachability and remaining delta

The pinned registry entry declares nativeInvokeProtocol `bedrock-invoke`.
The handler prepares a native plan, then dispatches it before generic embedding
fetch. It is reachable, not a disabled placeholder. Exact registry fields are
id `bedrock`, baseUrl
`https://bedrock-runtime.{region}.amazonaws.com/model/{model}/invoke`,
authType `apikey`, authHeader `bearer`.

Both local HEAD and freshly fetched `origin/main`
(`f7514b9ba3d0b341e0b5b422486049cf4f851a17`) embeddingProviders/index.js have
no Bedrock adapter. The existing provider uses alias `bedrock`, extra alias `br`,
AWS credentialForm, chat Converse URLs and chat models, with no embedding
serviceKind. Converse is not an equivalent InvokeModel embedding envelope.
No shared registry/catalog or production imports were changed. registration.json
names the serial integration points and exports; future registration must invoke
`embed`, retain selected credentials and signal, and propagate acceptedJob,
accounting and connection-scoped quota errors without replaying accepted work.
Existing bearer, static AWS and profile/SSO connection modes must remain intact.

## Supported subset

Six exact source model IDs are exported. Titan text V1/V2 and Titan multimodal
text inputs use one InvokeModel per item; Cohere V3/V4 sends a batched texts
array with input_type. V2 dimensions and normalize, multimodal embeddingConfig,
and Cohere output_dimension map to native fields. Known dimension values and
text task types are checked before any submission. V1 accepts only its fixed
width and omits the redundant dimension field. Plain text only, at most 96
items and 20000 characters each. Float and locally packed little-endian float32
base64 outputs are supported. Unknown fields, images, URLs as media objects,
token arrays, streams, unknown model IDs and inference profile execution are
rejected. No media fetching, result URLs, browser, sockets beyond HTTP, or polling
is needed. Titan image model metadata describes its text execution subset here;
image support must not be advertised by registration.

Only selected-connection bearer apiKey/accessToken authentication is supported.
Static AWS key/profile/session-token shapes are rejected before network access,
never interpreted as a bearer secret. Existing production AWS credential code is
untouched. Region defaults to us-east-1, or validated explicit region / a region
extracted from a strict AWS hostname. Connection URLs cannot select an origin.
All invokes use a fixed AWS runtime origin and manual redirect refusal.

Vectors must have exact count and width and finite float32-compatible values;
Titan flat/embeddingsByType.float and Cohere bare/keyed float matrices normalize
to an OpenAI list in input order. No int8 fallback. Reported Titan token counts
are aggregated. Missing usage leaves accounting tokens empty and cost unknown;
response usage zero fallback does not imply free work. No cost is fabricated.

## Discovery and deliberate safety deviations

Discovery ports the source control-plane endpoints: foundation-models with
byOutputModality=TEXT and SYSTEM_DEFINED inference-profile pagination. It uses
Accept/Content-Type JSON and selected Bearer credentials, returns only known
embedding IDs observed directly or in foundation model ARNs, and never expands
the executable model allowlist. Source discovery may include chat IDs and
profile IDs; these are intentionally filtered. Source optional profile failures
fall back to warnings; this staged service fails closed with sanitized errors.
Pagination is bounded to ten pages with cycle detection and a 30-second total
deadline, with 2 MiB response limits. Registration must not claim unrestricted
Bedrock model discovery or inference-profile execution.

Invokes share a 60-second total deadline across submission and body reads, capped
at 16 MiB per answer. Abort signals stop waiting and cancel network/body work.
Unknown send outcomes, 5xx, malformed successful answers and partial fan-out
carry acceptedJob with unknown cost. A proven pre-connect failure does not.
No automatic retries occur. Redirects are refused; unexpected foreign-origin
answers are uncertain submissions. Upstream error bodies and transport messages
are never returned. 402 is connection-scoped quota exhaustion; 429 preserves
only bounded Retry-After evidence. In-band partial failures are sanitized and
conservatively treated as unusable accepted work rather than echoing source
messages. There is no global credential/cache state.

## Evidence

Closed mocked tests only; no accounts, provider traffic or paid API calls.
Focused command: `cd tests && node node_modules/vitest/vitest.mjs run
unit/native-bedrock-embedding.test.js --maxWorkers=2`.
Scoped ESLint covers the staged directory and test. Tests cover source native
headers/envelopes, all six model response shapes, dimensions, batch ordering,
usage, two keys, quota/errors, validation, redirects, malformed results,
pre-connect versus uncertain reset, abort/deadline/body stalls, partial fan-out,
and discovery filtering/pagination/deadlines. Staging identity negatives are in
one isolated block; protocol/security tests do not depend on registration state.
Full CI is intentionally reserved for the serial integration gate.

Final focused evidence: 47 tests passed; scoped ESLint exited 0.
