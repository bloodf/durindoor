# DashScope video credential variants (staged), 2026-11-27

Issue: #2034. Decision 15 accepted the `dashscope-video` delta for three existing credential identities: `qwen-cloud` (`qwc`), `qwen-cloud-token-plan` (`qct`) and `bailian-coding-plan` (`bcp`).

## Source

OmniRoute at `c71f0065a7efe9230ec23b96a12253b050c4d7ad` (MIT). Files were read from that pinned commit only.

- `open-sse/config/videoRegistry.ts`:

  | id | alias | baseUrl | statusUrl | models |
  | --- | --- | --- | --- | --- |
  | `qwen-cloud` | `qwc` | `https://dashscope-intl.aliyuncs.com/api/v1` | `…/api/v1/tasks` | `happyhorse-1.1-i2v`, `happyhorse-1.1-t2v`, `happyhorse-1.1-r2v`, `happyhorse-1.0-video-edit`, `wan2.7-t2v`, `wan2.7-i2v`, `wan2.7-r2v-2026-06-12`, `wan2.7-videoedit` |
  | `qwen-cloud-token-plan` | `qct` | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/api/v1` | `…/api/v1/tasks` | the three `happyhorse-1.1-*` ids |
  | `bailian-coding-plan` | `bcp` | `https://coding-intl.dashscope.aliyuncs.com/api/v1` | `…/api/v1/tasks` | the three `happyhorse-1.1-*` ids |

  All three: `authType: "apikey"`, `authHeader: "bearer"`, `format: "dashscope-video"`.
- `open-sse/handlers/videoGeneration.ts`: `format === "dashscope-video"` dispatches to `handleDashscopeVideoGeneration`.
- `open-sse/handlers/videoGeneration/dashscopeHandler.ts`:
  - Refuses a model outside the identity's own registry list.
  - Key `apiKey || accessToken`, sent as `Authorization: Bearer`.
  - `POST {baseUrl}/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`, then `GET {statusUrl}/{task_id}` every 2.5 s for up to 300 s. `SUCCEEDED` → `output.video_url`; `FAILED`/`UNKNOWN_ERROR` → 502.
  - Bodies: `qwen-cloud` uses `buildAlibabaMediaPayload`; it sends `wan2.7-t2v` and `wan2.7-i2v` through the same builders as the dated `wan2.7-t2v-2026-06-12` and `wan2.7-i2v-2026-04-25`. Token plan and coding plan use `buildHappyHorsePayload`.
  - The header comment states that the three identities "share wire helpers only; their model lists and connections stay isolated."
- `src/shared/constants/alibabaProviderRegions.ts`: `resolveAlibabaProviderMediaBaseUrl` can move each identity to a china-beijing host or a custom base URL. This is not ported; see "Not covered".

## Fresh-main check

- The three registry entries exist as API-key chat providers. None has video models, a `video` service kind or a `videoConfig`.
- `VIDEO_GENERATION_ADAPTERS` has no entry for any of the three ids or aliases. `getVideoGenerationAdapter` returns null for all six.
- `open-sse/handlers/videoProviders/alibaba.js` with `open-sse/services/alibabaVideo/` serves only `alibaba`/`ali`. It uses the same wire contract, but `runAlibabaVideoJob` accepts only the two `alibaba` origins and records usage under `alibaba`. `buildAlibabaVideoRequest` does not know the undated `wan2.7-t2v`/`wan2.7-i2v`. That is not an equivalent for these identities.

## What landed

All new files are under `open-sse/services/providerParity/native-dashscope-video/`:

| File | Role |
| --- | --- |
| `config.js` | Frozen per-identity registry fields, fixed hosts, model lists, and URL helpers. |
| `request.js` | `buildDashscopeVariantVideoRequest`: identity model gate, then the integrated `buildAlibabaVideoRequest` (read-only). |
| `job.js` | `runDashscopeVariantVideoJob`: identity-scoped submit and bounded poll. It reuses the integrated bounds and `alibabaVideoResultUrl` read-only. |
| `adapter.js` | `createDashscopeVariantVideoAdapter(providerId)` (`VIDEO_GENERATION_ADAPTERS` contract). |
| `index.js` | Re-exports and one default adapter per identity. |
| `registration.json` | Exports, ids, aliases, endpoints, models, local equivalence and serial registration steps. |

Tests: `tests/unit/native-dashscope-video.test.js`, 93 tests over a closed network. `open-sse/services/alibabaVideo/**`, `handlers/videoProviders/alibaba.js` and their tests are unchanged.

Nothing is registered. Only the isolated `staging state (isolated)` block asserts that. Protocol, model, auth, security and usage tests use the staged module directly and do not depend on that state.

## Supported subset

- Each identity accepts only its own source model list. A token-plan or coding-plan connection cannot run a `qwen-cloud` model, and `qwen-cloud` cannot run the `alibaba` dated ids it does not list (`wan2.7-t2v-2026-06-12`, `wan2.7-i2v-2026-04-25`, `wan2.6-i2v-flash`).
- The undated `wan2.7-t2v`/`wan2.7-i2v` are built with their dated sibling's rules, matching the source builders. The body carries the requested id, not the sibling's. Refusal messages also name the requested id.
- Body rules are the integrated builder's. They are stricter than the source: no raw `parameters`, https public media only, 720P/1080P, five ratios, `n` = 1, no ratio for image-to-video. Each case is refused before any request.
- `response_format` must be `url`. The result URL must be https, on a public literal host, with no userinfo. It is never fetched.

## Fork deviations (all safety)

- Each identity uses one fixed host. A connection whose `providerSpecificData.region` is not `global-sg`, or that has a custom `baseUrl`, is refused before any request. The key never goes to a host it was not issued for, and no host is substituted.
- Every fetch and the whole job are time-bounded and abortable. Redirects are refused, never followed with the key. Bodies are size-bounded.
- Upstream text never reaches an error; only a vendor code with a safe shape does. Errors redact the selected connection's secrets.
- Submit outcomes:

  | Outcome | Result |
  | --- | --- |
  | `Arrearage` or `AccessDenied.Unpurchased` (400/403) | 402 with `quotaExhausted` |
  | 401 | 401 |
  | 429 | 429, with `Retry-After` when present |
  | Other 4xx | Passed through, no accepted job |
  | 5xx, interrupted, timed out, or redirected by origin | Uncertain: `acceptedJob` (`submit-unknown`) |

- After acceptance, every outcome not seen to fail carries `acceptedJob` (`accepted`) and unknown cost. This includes `UNKNOWN_ERROR`, unknown states, an unusable URL, a different task id, the deadline and an abort.
- Nothing is resent. Only task checks retry on 429/503: up to five times, with backoff capped at 30 s.
- Usage is recorded once, under the identity that ran the job, as `{ videos: 1 }` with `jobId`. Cost is unknown.

## Not covered

- The china-beijing hosts (`dashscope.aliyuncs.com`, `token-plan.cn-beijing.maas.aliyuncs.com`, `coding.dashscope.aliyuncs.com`) and custom base URLs. These connections are refused.
- The caller's `timeout_ms` and `poll_interval_ms`. The source defaults of 300 s and 2.5 s are fixed.
- Task cancellation. The source never cancels, so an abandoned task may still bill; `acceptedJob` records that.
- DashScope image (`multimodal-generation/generation`) and SpeechSynthesizer audio for these identities. This unit stages the pinned video registry entries only.

## Registration (serial step)

Follow `registration.json` `integrationPoints`:

1. Add the three default adapters, with their aliases, to `VIDEO_GENERATION_ADAPTERS`.
2. Add each identity's video models (`kind: "video"`) and the `video` service kind to its registry entry.
3. Note the route in `docs/providers/catalog.mdx`.

Registration replaces only the isolated staging block with strict positive identity assertions.

## Verification

Closed mocks only. No live account, provider call, browser, Docker or paid API was used. The tests do not show live service behavior.

```sh
cd tests && node node_modules/vitest/vitest.mjs run unit/native-dashscope-video.test.js --maxWorkers=2
```
