# Bedrock embedding credential safety and source auth parity (#2034)

Private staging only. Promotion belongs to `register-native14`; this change does
not register any provider or alter production credentials. No runtime/provider
traffic, live credential exposure, or production reachability was established.

## Reproduction and fix

The actual `createBedrockEmbeddingAdapter().embed` path was exercised with a
mock transport before changing it. A synthetic connection shaped as
`{apiKey:"fake-aws-secret", providerSpecificData:{awsAccessKeyId:"fake-id"}}`
caused exactly one mocked POST with `Authorization: Bearer fake-aws-secret`.
The new regression failed on that captured call before the fix. This establishes
a defect in the private adapter, not a live leak. The original local guard only
covered the canonical `accessKeyId` shape and some profile/session fields.
The older native embedding report's blanket statement that static AWS shapes
were rejected was too broad.

A shared Bearer eligibility guard now refuses defined IAM cues at either
credential level before invoke or embedding discovery transport. Presence
includes empty strings, null and false, catching incomplete/malformed as well as
conflicting configurations. Fields are accessKeyId, awsAccessKeyId,
secretAccessKey, awsSecretAccessKey, sessionToken, awsSessionToken, profile,
awsProfile, authMode and credentialMode. Explicit mode selectors are unsupported
by this subset. Undefined fields are treated as absent. buildHeaders also cannot
return an IAM secret as Bearer. Opaque apiKey/accessToken remains supported;
no regex guesses whether a secret looks like a real AWS or Bedrock API key.
A secret without any distinguishing IAM metadata cannot be classified safely.
No credentials are stored, migrated, or read from plaintext session fields.
The production encrypted top-level sessionToken contract remains unchanged.

## Frozen source evidence and attribution

Compared the actual embedding implementation from **OmniRoute (MIT)**,
repository `cheaper-inference/OmniRoute`, exact commit
`3a17f7e908308a217887a7617c2c793b95ea83c0`, within the requested
2026-11-27T23:49:25.752045Z source freeze. Read that exact object in a private
scratch clone after it was absent from the shared source object database.
No later source heads were fetched or used. Prior staged port attribution stays
at c71f006 in registration.json; the supplemental pure JSON auth manifest records
this comparison independently.

- `open-sse/config/embeddingRegistry.ts:126`: Bedrock declares apikey/bearer and
  nativeInvokeProtocol bedrock-invoke with a regional runtime InvokeModel URL.
- `open-sse/handlers/embeddings.ts:430`: buildAuth chooses apiKey/accessToken and
  constructs Bearer. prepareBedrockTransport at 763 builds family batches.
  fetchBedrockEmbeddingBatch at 876 POSTs the prepared headers and JSON bodies
  using fetch. It does not call the chat SDK or an IAM signer.
- `open-sse/handlers/bedrockEmbeddings.ts`: Titan single-item fan-out and Cohere
  texts/input_type/output_dimension envelopes; Titan embedding or
  embeddingsByType.float and Cohere bare/keyed float outputs. Local exact model,
  dimension, finite float32 vector checks and text-only limits remain stricter.
  Source additionally accepts image inputs and family/profile model prefixes;
  this subset does not. Source defaults absent token usage to zero; local
  accounting keeps missing usage and cost unknown.
- `open-sse/config/bedrock.ts:38` describes source chat static IAM as
  providerSpecificData.awsAccessKeyId + apiKey secret, with plaintext
  awsSessionToken. The separate `open-sse/executors/bedrock.ts` consumes IAM.
  That chat support does not establish IAM embedding support.

**IAM embedding remains unsupported.** No SDK InvokeModel implementation or
SigV4 parity is claimed. Canonical/local static IAM, temporary sessions and
profiles are refused rather than converted into Bearer. The separate existing
native-bedrock-discovery SDK path is unchanged and not duplicated. Neither
embedding path resolves profiles, environment credentials, metadata or SSO.

The named sync comparison report is absent both in this checkout and at the
provided sync commit path; conclusions above come from direct frozen source
inspection and the local adapter mock, not that unavailable report.

## Isolation and execution safety

Each call clones its selected credentials before asynchronous work; region,
token, and proxy choices cannot change during batch execution. Proxy options
are resolved once from that snapshot and disable environment proxy fallback.
A connection baseUrl cannot override the fixed regional AWS endpoint (existing
strict hostname region inference is retained); no runtime endpoint override
option exists. Redirects are manual and refused, with foreign-origin answers
classified as uncertain work. Invoke retries and fallback replay remain absent.
Socket waits, response bodies and caller abort share bounded deadlines. Unknown
post-dispatch outcomes, malformed answers, 5xx and partial batches retain
acceptedJob accounting with unknown cost. Error bodies/secrets are not echoed.

## Validation

The new exact-named suite exercises the real staged adapter with mocked HTTP,
both credential shapes at both storage levels, missing secrets/sessions,
conflicts, malformed cues, opaque Bearer values, captured outgoing Authorization,
concurrent snapshots, two accounts/regions/proxies, and environment proxy refusal.
The unchanged native embedding suite covers input/dimensions/vectors, abort,
stalled body/send, redirects, malformed replies, quota, errors and no replay.
The unchanged AWS credential and SigV4 discovery suites preserve their separate
contracts; no SDK embedding proof is claimed.

Checks run only in a private /var/tmp snapshot with env -i, explicit PATH/LANG/CI,
private HOME/DATA_DIR/TMPDIR/cache/store, 300-second ceilings and maxWorkers=2.
Focused tests used borrowed dependency directories through symlinks. See the
validation deviation below; a read-only dependency guarantee cannot be claimed.
Focused command from tests/: `node node_modules/vitest/vitest.mjs run
unit/bedrock-embedding-auth-parity-2034.test.js unit/native-bedrock-embedding.test.js
unit/bedrock-aws-credentials.test.js unit/bedrock-sigv4-discovery-2034.test.js
--maxWorkers=2`. Root lint and scoped ESLint are also run. No whole-suite gate,
browser, real accounts or public registration was used. Final results below.


Final focused result: **157 tests passed** (49 new, 47 native embedding,
26 AWS credentials, 35 SigV4 discovery). Root lint exited 0: ESLint reported
348 warnings and zero errors; the anti-slop gate reported zero diagnostics.
Scoped ESLint and git diff --check passed. The three existing suites were left
byte-for-byte unchanged. No failure baseline was modified.

Validation deviation: invoking `npm run lint` led its `pnpm run lint:anti-slop`
step to unexpectedly run an install and dependency lifecycle scripts before
executing the gate. This violated the requested prohibition on dependency
installation through borrowed links. No repair/delete/relink was attempted
following discovery, and no assertion is made that borrowed dependencies stayed
unchanged. The command ran with the isolated credential-free environment, but
this does not make that deviation compliant. The code/test results above are
local evidence, not an independent clean-head promotion receipt.
