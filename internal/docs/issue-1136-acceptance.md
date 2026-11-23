# Issue #1136 Media Discovery & Endpoint-Specific Model Pickers Acceptance Audit

Audit of merged media model discovery, endpoint-specific routing, truthful rejection handling, and per-vendor offline fixtures against GitHub issue #1136 acceptance criteria.

Date: 2026-11-21  
Target: `bloodf/durindoor:main` (worktree branch `orq/toty04/n1136-audit-a1-l6`)  
Baseline: `93f6de64c69b17d52f790d6f14d09a74cffc7fa5`  
Issue: [#1136](https://github.com/bloodf/durindoor/issues/1136) (`test(media): audit discovery and endpoint-specific model pickers`)  
Parent Epic: #1060 | Roadmap: #1056 | Priority: P2 | Stage: 3

---

## 1. Executive Summary & Verification Evidence

Issue #1136 addresses empty media model pickers and invalid image/video selections by verifying and enforcing that consumers use modality-specific catalogs and transport capabilities rather than chat-only capabilities. The implementation is anchored by:
1. Unified transport metadata and support checking ([`src/shared/constants/mediaRoutes.js`](../../src/shared/constants/mediaRoutes.js) and [`src/sse/services/mediaTransport.js`](../../src/sse/services/mediaTransport.js)).
2. Discovery candidate filtering across endpoints ([`src/sse/services/mediaRoutes.js`](../../src/sse/services/mediaRoutes.js)).
3. Truthful endpoint-specific error messages that name alternate supported routes (e.g., synchronous `/v1/video/generations` vs. asynchronous `/v1/videos`).
4. Offline per-vendor request/response fixtures with explicit documentation sources and declared live verification gaps ([`tests/fixtures/media/`](../../tests/fixtures/media)).

### Focused Test Suite Execution

Focused verification command:
```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/1136-media-discovery.test.js unit/1136-video-transport.test.js --maxWorkers=2
```

Execution results:
- **Test files**: 2 passed (2 total)
- **Tests**: 28 passed (28 total, 0 failed)
- **Duration**: ~5.11s
- **Breakdown**:
  - [`tests/unit/1136-media-discovery.test.js`](../../tests/unit/1136-media-discovery.test.js): 25 passed
    - Media kind transport metadata coverage (kinds, config keys, endpoints, reverse lookup)
    - Transport support per provider (registry validation, known unsupported providers, unknown/custom rows)
    - Discovery against transport (filtering non-transport providers, adapter requirements)
    - Endpoint-specific model selection (sync vs. async video endpoints, route order retention)
    - Truthful rejections at video endpoints (sync-only vs. job-only provider guidance, chat model refusal)
    - Offline per-vendor request/response fixtures (schema, verifiedLive: false, liveGap documentation, adapter matching for Fal.ai, MiniMax China, Gemini, Venice, ElevenLabs, Deepgram)
  - [`tests/unit/1136-video-transport.test.js`](../../tests/unit/1136-video-transport.test.js): 3 passed
    - Synthetic fixture pinning for synchronous video (`veoaifree-web.video-sync.json`)
    - Async submission and polling matching for MiniMax (`minimax.video-async.json`)
    - Endpoint-specific sync/async mismatch errors with unknown model ID tolerance

### Associated Regressions & Supporting Suites
The following related test suites further support the media discovery and routing integration:
- [`tests/unit/media-catalog-audit.test.js`](../../tests/unit/media-catalog-audit.test.js): Verifies that every routable media row in the registry has a dispatcher, every config model is a catalog row, and `/v1/models/{kind}` publishes routable IDs.
- [`tests/unit/model-select-modal-media-kind.test.js`](../../tests/unit/model-select-modal-media-kind.test.js): Verifies dashboard UI model picker isolation by `kindFilter` (video vs. music) and catalog endpoint switching under `hidePaidModels`.
- [`tests/unit/tui-combo-kind.test.js`](../../tests/unit/tui-combo-kind.test.js): Verifies CLI combo creation filters out non-chat models (`image`, `webFetch`, `agent`).
- [`tests/unit/nonchat-model-kind.test.js`](../../tests/unit/nonchat-model-kind.test.js): Verifies upfront HTTP 400 rejection of chat models across rerank, music, speech, embeddings, video, translation, and transcription handlers before credential resolution or network dispatch.
- [`tests/unit/image-model-kind.test.js`](../../tests/unit/image-model-kind.test.js): Verifies rejection of chat models on image generation and edit endpoints.
- [`tests/unit/media-routes.test.js`](../../tests/unit/media-routes.test.js): Verifies route normalization, legacy ID resolution, and automatic fallback order resolution.

---

## 2. Acceptance Criteria Verification Matrix

| Acceptance Criterion | Implementation Scope & Mechanism | Exact Code Locations | Covering Tests | Status |
|---|---|---|---|---|
| **1. Check dashboard, CLI, /models and native service registries against supported transport** | • `MEDIA_KIND_TRANSPORTS` defines required config blocks and endpoints for all 8 media kinds.<br>• `mediaTransportSupport` validates provider transport support (`supported`, `unsupported`, `unknown`).<br>• `listMediaRouteCandidates` filters `/models` candidates by transport support.<br>• `ModelSelectModal.js` enforces `kindFilter` and queries `/api/v1/models/{kind}` under `hidePaidModels`.<br>• CLI combo menu excludes non-chat kinds.<br>• Registry models lacking transport must declare `routingUnavailableReason`. | • [`src/shared/constants/mediaRoutes.js:41-57`](../../src/shared/constants/mediaRoutes.js)<br>• [`src/sse/services/mediaTransport.js:31-73, 83-105`](../../src/sse/services/mediaTransport.js)<br>• [`src/sse/services/mediaRoutes.js:59-68, 94-121`](../../src/sse/services/mediaRoutes.js)<br>• [`src/shared/components/ModelSelectModal.js:38-53, 98-100`](../../src/shared/components/ModelSelectModal.js)<br>• [`cli/src/cli/menus/combos.js:13-42`](../../cli/src/cli/menus/combos.js)<br>• [`docs/features/media-routes.mdx:1-97`](../../docs/features/media-routes.mdx) | • [`tests/unit/1136-media-discovery.test.js:134-228`](../../tests/unit/1136-media-discovery.test.js)<br>• [`tests/unit/media-catalog-audit.test.js:58-100`](../../tests/unit/media-catalog-audit.test.js)<br>• [`tests/unit/model-select-modal-media-kind.test.js:38-114`](../../tests/unit/model-select-modal-media-kind.test.js)<br>• [`tests/unit/tui-combo-kind.test.js:12-42`](../../tests/unit/tui-combo-kind.test.js) | **Met** (Offline verification; live catalog sync mocked) |
| **2. Reject unsupported modality/model pairs with truthful errors** | • `mediaEndpointSupport` and `endpointReason` evaluate endpoint compatibility and return explicit guidance naming the alternative route (e.g. `/v1/videos` vs. `/v1/video/generations`).<br>• Handlers across video, image, TTS, STT, embeddings, music, rerank, and search validate model kinds upfront, returning HTTP 400 with descriptive error messages before credential evaluation or network I/O.<br>• Core video generation and proxy handlers enforce sync vs. async job dispatch contracts. | • [`src/sse/services/mediaTransport.js:108-142`](../../src/sse/services/mediaTransport.js)<br>• [`src/sse/handlers/video.js:45-56, 120-131`](../../src/sse/handlers/video.js)<br>• [`open-sse/handlers/videoGenerationCore.js:12-25`](../../open-sse/handlers/videoGenerationCore.js)<br>• [`open-sse/handlers/videoCore.js:35-50`](../../open-sse/handlers/videoCore.js)<br>• [`src/sse/handlers/imageGeneration.js:38-50`](../../src/sse/handlers/imageGeneration.js) | • [`tests/unit/1136-media-discovery.test.js:230-294`](../../tests/unit/1136-media-discovery.test.js)<br>• [`tests/unit/1136-video-transport.test.js:37-44`](../../tests/unit/1136-video-transport.test.js)<br>• [`tests/unit/nonchat-model-kind.test.js:46-98`](../../tests/unit/nonchat-model-kind.test.js)<br>• [`tests/unit/image-model-kind.test.js:38-50`](../../tests/unit/image-model-kind.test.js) | **Met** (Cross-kind matrix boundaries documented) |
| **3. Use per-vendor request/response fixtures and document live verification gaps** | • 8 per-vendor offline fixtures stored in `tests/fixtures/media/*.json` across 6 modalities (image, embedding, tts, stt, async video, sync video).<br>• Every fixture pins exact documentation URL, sets `verifiedLive: false`, and provides a detailed `liveGap` (>40 chars).<br>• Video fixtures are explicitly flagged with `synthetic: true`.<br>• Test assertions verify adapter request generation, authentication headers, query parameters, and response normalization against fixtures without making network calls. | • [`tests/fixtures/media/`](../../tests/fixtures/media) (8 fixture files)<br>• [`open-sse/handlers/imageProviders/index.js`](../../open-sse/handlers/imageProviders/index.js)<br>• [`open-sse/handlers/embeddingProviders/index.js`](../../open-sse/handlers/embeddingProviders/index.js)<br>• [`open-sse/handlers/ttsProviders/index.js`](../../open-sse/handlers/ttsProviders/index.js)<br>• [`open-sse/handlers/sttCore.js`](../../open-sse/handlers/sttCore.js)<br>• [`internal/docs/media-model-kind-audit.md:53-76`](../../internal/docs/media-model-kind-audit.md) | • [`tests/unit/1136-media-discovery.test.js:296-426`](../../tests/unit/1136-media-discovery.test.js)<br>• [`tests/unit/1136-video-transport.test.js:13-35`](../../tests/unit/1136-video-transport.test.js) | **Met** (Live verification gaps documented per fixture) |

---

## 3. Detailed Audit by Acceptance Criterion

### Criterion 1: Check dashboard, CLI, /models and native service registries against supported transport

#### 1. Native Service Registries & Transport Mapping
- DurinDoor maintains service kind constants in [`src/shared/constants/mediaRoutes.js`](../../src/shared/constants/mediaRoutes.js), defining `MEDIA_KIND_TRANSPORTS` across eight modalities:
  - `tts`: `ttsConfig`, endpoint `/v1/audio/speech`
  - `stt`: `sttConfig`, endpoints `/v1/audio/transcriptions`, `/v1/audio/translations`
  - `webSearch`: `searchConfig`, endpoint `/v1/search`
  - `webFetch`: `fetchConfig`, endpoint `/v1/web/fetch`
  - `embedding`: `embeddingConfig`, endpoint `/v1/embeddings`
  - `image`: `imageConfig`, endpoint `/v1/images/generations`
  - `video`: `videoConfig`, endpoints `/v1/video/generations`, `/v1/videos`
  - `music`: `musicConfig`, endpoint `/v1/music/generations`
- Transport verification logic in [`src/sse/services/mediaTransport.js`](../../src/sse/services/mediaTransport.js) classifies provider capabilities into three states:
  - `"supported"`: Provider possesses a concrete dispatch mechanism (adapter, config, or handler).
  - `"unsupported"`: Provider is known in the registry and advertises the service kind, but lacks the requisite transport dispatcher (e.g., `aws-polly` declares TTS but has no synthesis adapter; `topaz` lacks image adapter; `orcarouter` lacks embedding adapter).
  - `"unknown"`: Provider is unrecognized in the local registry (e.g., a custom node or dynamic remote catalog row); requests remain dispatchable so custom implementations are not blocked.
- [`tests/unit/1136-media-discovery.test.js:158-202`](../../tests/unit/1136-media-discovery.test.js) verifies that every registry entry declaring a media kind either has a functional transport or explicitly specifies `routingUnavailableReason`.

#### 2. `/models` Catalog & Media Candidate Discovery
- The `/v1/models/{kind}` discovery endpoint and `listMediaRouteCandidates` in [`src/sse/services/mediaRoutes.js:59-68`](../../src/sse/services/mediaRoutes.js) actively filter candidate models using `mediaTransportSupport(kind, provider) !== "unsupported"`.
- Providers without transport (e.g., AWS Polly for TTS, Topaz for image) are pruned from discovery candidates, preventing empty pickers or unroutable default selections.
- Keyless providers are verified through `isKeylessProviderWorking` probes (with 30-second caching).

#### 3. Dashboard Surface
- [`src/shared/components/ModelSelectModal.js`](../../src/shared/components/ModelSelectModal.js):
  - Model selection modals receive `kindFilter` (e.g. `video`, `music`).
  - When `hidePaidModels: true` is active, the modal switches its catalog fetch to `/api/v1/models/{kind}` instead of the generic `/api/v1/models`, ensuring paid and chat-only models are excluded from media pickers.
  - Verified in [`tests/unit/model-select-modal-media-kind.test.js:38-114`](../../tests/unit/model-select-modal-media-kind.test.js).
- Dashboard Media Routes page ([`docs/features/media-routes.mdx:58-76`](../../docs/features/media-routes.mdx)) exposes endpoint-level cards driven by `MEDIA_ROUTE_ENDPOINTS`, indicating which models run on which endpoints.

#### 4. CLI Surface
- [`cli/src/cli/menus/combos.js:13-42`](../../cli/src/cli/menus/combos.js):
  - When creating combos via the terminal UI, non-chat models (`image`, `webFetch`, `agent`, etc.) are filtered out.
  - Only chat models (`kind: "llm"`) or unclassified/custom rows remain selectable for chat combos.
  - Verified in [`tests/unit/tui-combo-kind.test.js:12-42`](../../tests/unit/tui-combo-kind.test.js).

---

### Criterion 2: Reject unsupported modality/model pairs with truthful errors

#### 1. Truthful Guidance Between Transport Variations
- The video domain features two distinct transports:
  - Synchronous generation via `handleVideoGeneration` at `/v1/video/generations`.
  - Asynchronous job lifecycle via `handleVideoCreate` / `handleVideoProxyCore` at `/v1/videos`.
- [`src/sse/services/mediaTransport.js:108-118`](../../src/sse/services/mediaTransport.js) provides truthful error messages directing callers to the compatible endpoint:
  - Job-only provider called synchronously:
    `"Provider 'xai' does not support synchronous video generation on /v1/video/generations. Use /v1/videos for asynchronous video jobs."`
  - Sync-only provider called asynchronously:
    `"Provider 'veoaifree-web' does not support asynchronous video jobs on /v1/videos. Use /v1/video/generations for synchronous video generation."`
  - General unsupported kind:
    `"Provider '<id>' does not support <kind> on <endpoint>."`
- Verified in [`tests/unit/1136-media-discovery.test.js:270-294`](../../tests/unit/1136-media-discovery.test.js) and [`tests/unit/1136-video-transport.test.js:37-44`](../../tests/unit/1136-video-transport.test.js).

#### 2. Early Model-Kind Rejections Across Endpoints
- Non-chat media endpoints enforce early validation:
  - If a known chat model (e.g., `openai/gpt-4o`) is passed to `/v1/images/generations`, `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/embeddings`, `/v1/video/generations`, `/v1/videos`, `/v1/music/generations`, or `/v1/rerank`, the request immediately returns HTTP 400.
  - Rejection happens before credential validation, account preflight checks, quota decrement, or network dispatch.
  - Verified across [`tests/unit/nonchat-model-kind.test.js:46-98`](../../tests/unit/nonchat-model-kind.test.js) and [`tests/unit/image-model-kind.test.js:38-50`](../../tests/unit/image-model-kind.test.js).

---

### Criterion 3: Use per-vendor request/response fixtures and document live verification gaps

#### 1. Per-Vendor Fixture Inventory & Coverage
The codebase establishes 8 offline JSON fixtures in [`tests/fixtures/media/`](../../tests/fixtures/media):

| Fixture File | Vendor | Modality | Transport Mode | Documentation Source URL | Live Verification Gap (`liveGap`) Summary |
|---|---|---|---|---|---|
| [`fal-ai.image.json`](../../tests/fixtures/media/fal-ai.image.json) | `fal-ai` | `image` | Asynchronous Queue | `https://docs.fal.ai/` | Queue poll intervals, upstream error bodies, account concurrency/rate limits unverified live. |
| [`minimax-cn.image.json`](../../tests/fixtures/media/minimax-cn.image.json) | `minimax-cn` | `image` | Synchronous REST | `https://platform.minimax.io/docs/api-reference/image-generation` | China host routing, content-filter status codes, upstream error bodies unverified live. |
| [`gemini.image.json`](../../tests/fixtures/media/gemini.image.json) | `gemini` | `image` | REST `generateContent` | `https://ai.google.dev/gemini-api/docs/image-generation` | Safety blocking structures, multi-modal prompt variations, upstream error bodies unverified live. |
| [`venice.embedding.json`](../../tests/fixtures/media/venice.embedding.json) | `venice` | `embedding` | REST OpenAI-compat | `https://docs.venice.ai/` | Dimension limits, upstream rate limiting, error responses unverified live. |
| [`elevenlabs.tts.json`](../../tests/fixtures/media/elevenlabs.tts.json) | `elevenlabs` | `tts` | REST Binary Stream | `https://elevenlabs.io/docs/` | Dynamic voice lists, output format negotiation, account quota exhaustion unverified live. |
| [`deepgram.stt.json`](../../tests/fixtures/media/deepgram.stt.json) | `deepgram` | `stt` | REST Binary Audio | `https://developers.deepgram.com/docs/` | Diarization, utterances, profanity filter payloads, streaming websocket variants unverified live. |
| [`minimax.video-async.json`](../../tests/fixtures/media/minimax.video-async.json) | `minimax` | `video` | Asynchronous Job (`synthetic: true`) | `https://platform.minimax.io/docs/api-reference/video-generation` | Synthetic fixture. Account entitlements, model availability, polling cadence, terminal failure variants unverified live. |
| [`veoaifree-web.video-sync.json`](../../tests/fixtures/media/veoaifree-web.video-sync.json) | `veoaifree-web` | `video` | Synchronous Web (`synthetic: true`) | `https://veoaifree.com/` | Synthetic fixture. Web form nonce expiration, polling cadence, service availability unverified live. |

#### 2. Strict Verification Contract & Live Gap Governance
- [`tests/unit/1136-media-discovery.test.js:296-321`](../../tests/unit/1136-media-discovery.test.js) enforces contractual metadata rules across every fixture:
  - `data.verifiedLive === false` unless `data.liveEvidence` is present.
  - `data.source` must be an HTTPS URL.
  - `data.liveGap` must exceed 40 characters of concrete gap description.
  - Each fixture covers only vendors for which the gateway possesses active transport support.
- Adapter tests execute request payload construction, header compilation, response parsing, and normalized body validation against these fixtures with mocked fetch responses.

---

## 4. Concrete Remaining Gaps & Verification Limitations

While all three acceptance criteria have verified code and test implementations in the repository, the following concrete boundaries and limitations remain:

1. **No Live Provider Calls (`RUN_REAL=1` Gap)**:
   - All tests run offline with mocked fetch responses. No live upstream provider calls were made against production endpoints.
   - Upstream rate limit behavior (e.g., HTTP 429 Retry-After headers, burst throttling), account balance exhaustion, dynamic model deprecation, and unexpected HTML/non-JSON upstream error pages remain unverified live.
   - Every fixture explicitly maintains `verifiedLive: false`.

2. **Modalities Lacking Dedicated Per-Vendor JSON Fixtures**:
   - The current fixture suite covers `image`, `embedding`, `tts`, `stt`, and `video` (sync and async).
   - Three media route kinds lack standalone JSON fixtures in [`tests/fixtures/media/`](../../tests/fixtures/media):
     - `music` (`musicConfig`)
     - `webSearch` (`searchConfig` / `searchViaChat`)
     - `webFetch` (`fetchConfig`)
   - While handler-level rejection of chat models for these kinds is tested ([`tests/unit/nonchat-model-kind.test.js`](../../tests/unit/nonchat-model-kind.test.js)), per-vendor upstream request/response payloads are not captured as offline fixtures for music and search/fetch.

3. **Incomplete Exhaustive Pairwise Cross-Kind Matrix**:
   - Upfront rejection of known chat models (`openai/gpt-4o`) is thoroughly verified across all media endpoints.
   - Cross-kind rejection of other non-chat models (e.g., passing a TTS model to `/v1/images/generations`, or an embedding model to `/v1/audio/transcriptions`) relies on the common `isNonChatModel` helper and generic checks rather than dedicated handler-level test cases for every endpoint-to-modality pair.
   - Fetch handler ([`src/sse/handlers/fetch.js:192`](../../src/sse/handlers/fetch.js)) dispatches based on provider identity rather than model strings, meaning model-kind validation does not directly apply to fetch requests.

4. **CLI Scope Boundary**:
   - CLI coverage is limited to combo creation filtering in [`cli/src/cli/menus/combos.js`](../../cli/src/cli/menus/combos.js).
   - The CLI does not currently expose dedicated interactive menus or subcommands for managing default media routes (`settings.mediaRoutes`) or directly invoking media endpoints; media route configuration is managed via the Next.js web dashboard or direct REST API calls.

5. **UI & Browser Verification Limitations**:
   - Dashboard UI components ([`src/shared/components/ModelSelectModal.js`](../../src/shared/components/ModelSelectModal.js)) are verified using Vitest with `happy-dom` and `react-dom/server` / React `act` environments.
   - Full end-to-end browser interactions across mobile and desktop viewport variations, drag-and-drop fallback reordering, and live SSE/polling status updates are not covered in real browser automated suites.

6. **Open OmniRoute Upstream Candidates**:
   - Issue #1136 references several open upstream candidate issues from OmniRoute:
     - OmniRoute #15971: `fal rewrites vendor model ids and rejects duration and resolution`
     - OmniRoute #15972: `Google AI Studio image models have no image route`
     - OmniRoute #15536: `Agnes video: /v1/videos/generations returns 429 "too many video status queries"`
     - OmniRoute #15538: `pollinations/default is listed as a video model but returns 400 "Unsupported video format"`
   - These issues remain open upstream. DurinDoor's local guards ensure unroutable rows are pruned and mismatched endpoints are rejected truthfully, but upstream resolutions are still pending.

---

## 5. Conclusion & Acceptance Status

Issue #1136 acceptance criteria are **satisfied for offline and codebase integration contracts**:
- **Criterion 1 (Discovery & Transport Check)**: Satisfied. Transport metadata, registry validation, `/models` filtering, dashboard modal kind isolation, and CLI combo filtering are implemented and tested.
- **Criterion 2 (Truthful Rejections)**: Satisfied. Misrouted synchronous vs. asynchronous video endpoints return explicit guidance naming the alternative route, and media endpoints reject chat models upfront.
- **Criterion 3 (Per-Vendor Fixtures & Live Gaps)**: Satisfied. 8 per-vendor fixtures cover image, embedding, speech, transcription, and video with documented sources, mandatory `verifiedLive: false`, and detailed `liveGap` statements.

All claims are supported by 28 passing unit tests across [`tests/unit/1136-media-discovery.test.js`](../../tests/unit/1136-media-discovery.test.js) and [`tests/unit/1136-video-transport.test.js`](../../tests/unit/1136-video-transport.test.js), supplemented by catalog, handler, and UI modal suites. Live provider verification remains intentionally unperformed and documented as an open boundary.
