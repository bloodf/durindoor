# Register native batch 2: restored public-route coverage

Refs #2034.

## What changed

Registration candidate `800ccf5d5b` carried a public-route suite of about 770 lines in
`tests/unit/register-native-02.test.js`. Replacement `78ed18c37c` rewrote that file
to 326 lines. The replacement file stays byte-frozen, including its music no-replay
checks. The full original suite now lives next to it as
`tests/unit/register-native-02-original-contract.test.js`.

The recovered file keeps all 68 original cases and every assertion:

- catalog, auth, and current chat entries stay unchanged
- typed models and source-unknown schema discovery
- fal.ai canonical and alias submit, poll, selected key, and usage recorded once
- music returns every format, with no replay
- KIE Market, Kontext special paths, image and video
- quota, auth, and rate account scope
- unknown-model decline and refusal before credentials are read
- timeout, cancel, malformed results, and billing recorded once
- Google Flow stays disabled

Adapters run with their default request deadlines on the shared fake clock. The suite
adds no real short deadlines.

## The one adapted assertion

In `800ccf5d5b`, `fal-ai.js` declared
`musicConfig: { baseUrl, format: "fal-ai-music" }`. The registered row now carries the
staged contract's `musicConfig: { baseUrl: "https://queue.fal.run" }`, as
`native-fal-ai-music/registration.json` specifies. No runtime code reads
`musicConfig.format`. `handleMusicGenerationCore` sends `fal-ai` and `fal` to the
ACE-Step adapter by provider ID, the same way it routes MiniMax and Vertex. Missing
`format` is therefore not a runtime bug, and no handler changed.

The equivalent observable assertions are:

- `falRegistry.musicConfig` equals `{ baseUrl: QUEUE }` and the staged `FAL_MUSIC_PROVIDER_METADATA.musicConfig`
- `FAL_MUSIC_PROVIDER_METADATA.format` stays `"fal-ai-music"`
- dispatch by provider ID is proven by the public `/v1/music/generations` cases in the same file and by the spy case below

## Isolated registration blocks

- `native-fal-ai-video.test.js`: restores the exact registry video model ID check (`FAL_VIDEO_MODEL_IDS`).
- `native-fal-ai-music.test.js`: restores the `ace-step` music row, the `musicConfig` checks above, and the spy-based canonical and alias dispatch (two calls to the canonical adapter, no network). The existing closed-network dispatch case stays as an additional check.
- `native-kie-video-image.test.js`: the adapter-identity checks use `staged.kieImageAdapter` and `staged.kieVideoAdapter`. Those are the same object references as in the original.

These three isolated blocks had stale comments saying the adapter was unregistered. The
comments are corrected. The KIE TTS/STT negatives and the positive LLM, image, and video
checks are unchanged. Outside the isolated blocks, no staged protocol, security, or
usage assertion changed. The private adapter runtime did not change.

## Evidence

```bash
cd tests && node node_modules/vitest/vitest.mjs run unit/register-native-02-original-contract.test.js \
  unit/register-native-02.test.js unit/native-fal-ai-video.test.js unit/native-fal-ai-music.test.js \
  unit/native-kie-video-image.test.js unit/native-googleflow-video.test.js --maxWorkers=2
# Test Files 6 passed (6); Tests 382 passed (382)
```
