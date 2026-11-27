# Google Flow video (staged, disabled at source), 2026-11-27

Issue: #2034. Decision15 accepted this delta. The parity inventory row in `provider-native-capabilities-1127.md` is `googleflow`: registry -> `googleFlowHandler.ts`; Google session/account credential, Flow operation envelope; DurinDoor equivalent: none (MISSING).

**Outcome:** the pinned source entry is disabled. In OmniRoute it is a provider that answers 501 to every request, not a working video provider. This port stages that disabled contract and records the evidence. It does not activate Google Flow.

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). A `git rev-parse HEAD` in `/tmp/omni-2034` confirmed that commit.

- `open-sse/config/videoRegistry.ts`: the `googleflow` entry has `id: "googleflow"`, `alias: "flow"`, `baseUrl: "https://aisandbox-pa.googleapis.com"`, `authType: "oauth"`, `authHeader: "bearer"` and `format: "google-flow"`. Its models are `veo-3.1-generate`, `veo-3.1-fast-generate` and `veo-3.0-generate`. It also sets `unsupported: true` and an `unsupportedReason` (copied verbatim into `config.js`).
- `open-sse/handlers/videoGeneration.ts`: dispatches `google-flow` to `handleGoogleFlowVideoGeneration`.
- `open-sse/handlers/videoGeneration/googleFlowHandler.ts`: returns `{ success: false, status: 501, error: sanitizeErrorMessage(unsupportedReason || fallback) }`. It makes no network call and does not read the credentials or the body.
- `open-sse/handlers/videoGeneration/googleFlow.ts`: the request and response transforms, which the source itself marks PENDING LIVE VALIDATION. Nothing in the source calls them at this commit.
- `src/app/api/v1/videos/generations/route.ts`: `resolveVideoCredentialProvider` maps `googleflow` to the `antigravity` connection.

## Evidence that the source is disabled

The following is quoted from the source comments on `videoRegistry.ts` `googleflow` and on `googleFlowHandler.ts` (#10285, which reverted #4769/#4569):

1. `POST /v1:generateVideo` and `POST /v1:fetchOperation` on `aisandbox-pa.googleapis.com` return 404.
2. The reporter measured `POST /v1/video:batchAsyncGenerateVideoText` as a working path. That path is undocumented, and it rejects the stored Cloud Code OAuth bearer with 401 UNAUTHENTICATED, because the cclog/cloud-platform scopes do not grant aisandbox-pa.
3. According to gflow-cli, only a headed-browser reCAPTCHA session works for mutation endpoints.

The OmniRoute CHANGELOG entry for #10285 reads: "stop advertising the googleflow (Veo) video provider as working and fail fast with a clear diagnostic".

Activating the provider would mean inventing an endpoint, an envelope and a browser/reCAPTCHA transport that the source never validated. This port does not do that.

## What already existed locally

Nothing. A checkout-only `rg 'googleflow|google-flow|aisandbox'` over `open-sse` and `src` finds no match. `open-sse/handlers/videoProviders/index.js` registers only `renderhour`, `adobe-firefly-api` and `adobe-firefly-web`. `open-sse/providers/registry/antigravity.js` holds chat models only. No provider or alias is named `flow`. The local video route (`src/sse/handlers/video.js`) looks credentials up by the resolved provider id and has no `googleflow -> antigravity` mapping.

## What landed (private, unregistered)

| File | Role |
| --- | --- |
| `open-sse/services/providerParity/native-googleflow-video/config.js` | The id, alias, format, host, auth declaration, three models, the verbatim unsupported reasons, the evidence paths and metadata with `supported: false`. |
| `.../adapter.js` | A fail-fast job adapter. `generate()` returns a 501 error result carrying the source reason. |
| `.../contract.js` | The dormant transforms ported from `googleFlow.ts`, plus `googleFlowPublicArtifact` (fork hardening). |
| `.../index.js` | Re-exports the modules above. |
| `.../registration.json` | Exports, ids, models, endpoints, the disabled evidence and the recommended registration, which is none. |
| `tests/unit/native-googleflow-video.test.js` | 20 tests. `global.fetch` is replaced with a spy that fails the test if called. |

Production code imports none of these modules. The test that checks the unregistered state sits in its own `staging state` block.

## Supported subset

None. Every request to the adapter returns 501 with the source `unsupportedReason`, whatever the model, credential, input or signal.

- **Before submission:** the adapter refuses every request before any billable work. It never builds a request, reads a credential, starts a timer or opens a socket.
- **Accounting:** none. There is no `acceptedJob` and no `accounting`, because nothing is submitted.
- **Credentials:** the error is the same for any connection and contains no credential material. The tests use two synthetic Antigravity-shaped credentials to check this.
- **Response formats:** the metadata lists `supportedResponseFormats: []`. The adapter declares `url` and `b64_json` only so that the core format check does not hide the 501 diagnostic. Other formats still get the core's 400.

## Dormant contract (tested, not wired)

The ported `googleFlow.ts` contract:

- `normalizeFlowVideoParams` reads snake_case or camelCase fields and treats a ratio-shaped `size` as the aspect ratio.
- `buildGoogleFlowSubmitBody` builds `{ instances: [{ prompt }], parameters: { sampleCount, aspectRatio?, durationSeconds?, negativePrompt?, resolution? } }`.
- `parseFlowOperationName` accepts `{ name }` or `{ operation: { name } }`.
- `parseFlowOperationResult` reads `response.videos[0].bytesBase64Encoded | gcsUri | uri` or `response.generateVideoResponse.generatedSamples[0].video.uri | bytesBase64Encoded`.
- `resolveFlowProjectId` and `resolveFlowAccessToken` read the credential record.

These helpers describe a wire contract the source never validated live. They are not proof that any transport works.

Fork addition: any future transport must pass a parsed result through `googleFlowPublicArtifact`. It admits only well-formed base64 or an `https:` URL without userinfo. It rejects `gs://`, `http:`, `file:`, malformed base64 and error results.

## Restrictions and what a future activation needs

- A server-side transport validated live against aisandbox-pa, with a confirmed endpoint, envelope and credential, is a prerequisite. A browser or reCAPTCHA session would need its own connection mode. The existing Antigravity OAuth connection is not enough, according to the source's own evidence.
- Once such a transport exists, it needs bounded submit and poll deadlines, abort handling, a fixed origin with redirects refused, an `acceptedJob` on any uncertain submit with no replay, and `googleFlowPublicArtifact` on every output. The Vertex Veo job client in `native-vertex-video/job.js` is the local pattern to follow.
- Registration is not recommended while the source stays disabled. A fail-fast registration would also have to change `src/sse/handlers/video.js`. The route either looks up `antigravity` credentials for `googleflow` or answers 501 before the credential lookup. Otherwise users see "No credentials for provider: googleflow". `registration.json` lists the exact integration points.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/native-googleflow-video.test.js --maxWorkers=2
# Test Files 1 passed (1); Tests 20 passed (20)
npx eslint open-sse/services/providerParity/native-googleflow-video tests/unit/native-googleflow-video.test.js
# clean
node scripts/check-anti-slop.mjs
# anti-slop gate OK (0 diagnostics)
```
