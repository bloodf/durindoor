# Private Vertex embeddings (#2034)

Status: implemented as a private, unimported and unregistered stage. Activation
belongs exclusively to register-native14. No live GCP call or live parity claim.
Prepared against local base `e3658bc68363da17f6bf282170e4adfbb7029ae0`.

## Frozen evidence and attribution

Source: cheaper-inference/OmniRoute, MIT, PR #20103, exact commit
`3a17f7e908308a217887a7617c2c793b95ea83c0`, within the supplied
2026-11-27T23:49:25.752045Z freeze. Read from an owned temporary clone at that
commit, without updating the shared source or consulting later heads.

Compared source files:

- `open-sse/handlers/vertexEmbeddings.ts`: text-only plan, 250 inputs,
  RETRIEVAL_QUERY, optional outputDimensionality, per-input Gemini sends,
  predictions[].embeddings.values, estimated usage.
- `open-sse/handlers/embeddings.ts`: actual imports and Vertex prepare/dispatch,
  SA-only credential requirement, response cap and outer base64/model normalizer.
  Its Vertex plan uses the raw input, overriding the generic clamped body.
- `open-sse/config/embeddingRegistry.ts`: three model ids and default widths.
- `open-sse/config/vertexModels.ts`: actual getVertexHost implementation.
- `open-sse/executors/vertexAuth.ts`: jose SA token exchange and OAuth scopes.

Copyright (c) 2026 Cheaper Inference - Created by Diego Souza
https://github.com/diegosouzapw. The source MIT permission/warranty notice is
preserved verbatim in `native-vertex-embedding/LICENSE` next to this port's code.

Current local `handlers/embeddingProviders/index.js` imports/maps no Vertex
adapter. Gemini targets generativelanguage.googleapis.com with an API key;
that is not Vertex embedding parity. Existing Vertex video, speech, music and
OCR do not establish an embedding route. Existing canonical `vertex` and its
aliases remain unchanged; this stage creates no alternate provider identity.

## Contract and deliberate safety changes

Only `text-embedding-005` (768), `text-multilingual-embedding-002` (768), and
`gemini-embedding-001` (3072) are accepted. Inputs are 1..250 non-empty strings;
whitespace is accepted as in the source. Token ids and multimodal/structured
inputs fail before authentication or billable POST. No model length, price,
region availability or dimension upper bound is invented. Dimensions must be
positive JSON safe integers (source Number-coerces). The task type is fixed to
RETRIEVAL_QUERY; arbitrary task/input types and unknown parameters are refused.
The OpenAI `user` field is ignored. Float and local little-endian float32 base64
are supported, with encoding never forwarded to Google.

Bodies are `{instances:[{content,task_type}],parameters?:{outputDimensionality}}`.
Text models send one batch; Gemini sends each input sequentially and stops on
the first failure. Each reply must contain exactly the expected vector count,
requested/default width, and finite numeric values. Empty/ragged/non-numeric
vectors, invalid JSON and in-band errors are unusable accepted outcomes. Output
indices preserve input order. Model echo follows the source outer normalizer:
a supplied bare client id, otherwise `vertex/<resolved model>`.

The source estimates token usage locally. This port does not claim estimates
as provider receipts: accounting has empty tokens, `usageMissing: true`, unknown
cost, and returned-input native units. Public zero usage is explicitly tagged
as a compatibility placeholder in accounting. Native statistics are not guessed
to be tokens or money. No price or quota estimate is introduced.

## Credentials, locations and transport

Only explicit selected-account service_account JSON is supported, as in the
source embedding dispatch. The existing classifier and RSA-key validator are
reused. Explicit ADC authorized_user JSON, preset OAuth and Express API keys
are rejected before network even though other local Vertex modalities support
them. Unsupported/malformed JSON and AWS credentials cannot become Bearer/key.
No ambient ADC, metadata, filesystem credential, or token_uri fallback exists.

The SA project_id is validated and authoritative. A conflicting connection
projectId is refused. Local canonical `providerSpecificData.location` is used;
legacy source `region` is accepted only when location is absent or equal.
Conflicts require explicit connection migration. Empty/absent settings default
to us-central1. Valid location syntax includes regional ids, global and eu.

Crucial source comparison: getVertexHost returns `aiplatform.googleapis.com`
for BOTH global and regional locations; eu alone uses
`aiplatform.eu.rep.googleapis.com`. This differs from local Veo's regional
`<location>-aiplatform.googleapis.com` and its rejection of global. This stage
preserves the frozen embedding source host rule rather than borrowing Veo scope.
The fixed project/location path always selects publishers/google and an
allowlisted model with :predict. Runtime base URLs/publishers are ignored.
Token minting uses only https://oauth2.googleapis.com/token. Redirects are
manual and refused, and unexpected final URLs fail closed.

The selected proxy options and credential scope are cloned once before signing.
One abort controller/deadline spans signing, token send/body, every prediction
send/body, and batch aggregation. The actual signal reaches the network; an
outer race only additionally bounds transports that ignore abort. Late network
answers are cancelled. Response reads use the shared bounded reader (16 MiB
for predictions, 64 KiB for the token response). Errors expose no upstream
bodies, parser text, JWT, private keys, access tokens or credential JSON.
429 retains bounded Retry-After evidence. Auth refusals do not refresh/retry.

### Shared helper limitation

The current shared refreshVertexToken does not accept a signal, does not refuse
redirects and reads token JSON without a size/deadline bound. Veo's Promise.race
does not make its underlying mint abortable. Shared helpers and other private
adapters were outside the grant and remain untouched. This stage therefore
ports a small private SA minter using the already declared jose library and
shared classification/key validation; no new dependency or custom cryptography.
It preserves the frozen source OAuth scopes and has no token cache, avoiding
account/proxy cache crossover.

A future shared consolidation minimally needs an optional signal propagated to
proxyAwareFetch and bounded body reading, manual redirect refusal/final-origin
validation, sanitized failures, and preserved complete-credential/proxy cache
binding. Such a shared extension requires separate scope; it is not silently
claimed complete here.

## Accepted work and integration boundary

Postsubmit 5xx, timeout, abort, transport uncertainty and unusable 2xx carry
acceptedJob with unknown cost. Preconnect DNS/refused/connect-timeout and
explicit proven-unsent failures have no accepted marker unless an earlier
Gemini item succeeded. Every later batch failure, including 4xx or proven
unsent, retains the partial-work marker. No native resend/account replay occurs.

The private test registry fixture routes through the actual embeddingsCore
adapter.embed branch and proves no generic fetch/refresh retry. It does not
activate the production registry. Public selected-account fallback and ledger
persistence remain integration prerequisites, not proven by a fixture.

`registration.json` is the pure JSON handoff: exact exports, model rows, kinds,
auth refusals, location migration and handler/catalog/discovery/docs targets.
register-native14 must preserve current identity/aliases and existing kinds,
register the native adapter (not generic OpenAI), and ensure the public handler
records acceptedJob against the selected account and stops account fallback.
No registry/config/UI/docs activation or generated indices were changed here.

## Validation

All gates used an owned disposable checkout under
`/var/tmp/vertex-embedding-2034-gate`, isolated HOME, DATA_DIR, TMPDIR, cache and
pnpm store, and env -i with explicit PATH/LANG/CI. Root and tests dependencies
were installed there using frozen lockfiles; no shared borrowed dependencies
were repaired, deleted or relinked. Every gate command used timeout 300s;
focused Vitest commands used --maxWorkers=2. No full inventory or CI runner ran.

Network tests use explicitly generated fake RSA credentials and fake endpoint
responses only. Actual classification, key validation, jose JWT signing,
project/location resolution, token network request, body reads, normalization,
accounting and native core dispatch remain under test. Only the network boundary
and the private registry-selection fixture are substituted.

Final results are recorded below after the scoped run. No baseline entries,
skips, TODO tests or expected-failure rows were added. Existing Veo, speech and
retired-model tests are unchanged.

## Unresolved and live-unproved

No live Google acceptance, entitlement, model/location availability, actual
supported dimension range, provider quota behavior or billing receipt was
verified. The source host rule is implemented and tested, not certified live.
Public gateway fallback/accounting integration is deliberately not activated.
No independent external review or full merge checkpoint was requested or run;
these local focused checks are not a merge authorization.

Final local results:

- Root `pnpm lint`: passed; ESLint 0 errors / 348 existing warnings;
  anti-slop 0 diagnostics. Initial anti-slop failures in the new code were
  corrected using existing type helpers and explicit property assignment.
- `node node_modules/vitest/vitest.mjs run unit/native-vertex-embedding-2034.test.js --maxWorkers=2`
  from tests/: 69 passed, no skips.
- The explicit related command ran `unit/vertex-sa-key.test.js`,
  `unit/vertex-eu-endpoint.test.js`, `unit/native-vertex-video.test.js`,
  `unit/native-vertex-tts-stt.test.js`, `unit/vertex-retired-video-models.test.js`,
  and `unit/vertex-retired-transcription.test.js` with --maxWorkers=2:
  209 passed across six files, no skips.
- Total: 278 passing assertions. No production credentials or real endpoint
  calls; no baseline impact. Raw logs remain in the private gate directory.
