# 1073: bounded Responses tool-output image restoration

Source: merged [OmniRoute #18784](https://github.com/cheaper-inference/OmniRoute/pull/18784), pinned head `f93fc9f465a31d5a90946c35fe889c1035460eda` (merge commit `1d5c5c73da64af09a2dacefbe4e51f6771fab917`). Checked 2026-11-20.

## Disposition

**Ported, adapted to local contracts, with no configuration surface.** Both gaps the pinned fix addresses were present locally.

## Upstream change

`toolOutputImagesToChatParts()` re-injected every historical `input_image` from tool outputs into the follow-up Chat user message on every turn, with no limit. The fix keeps the newest images that fit 16 images and 20 MB (size is the image URL length), replaces older ones in place with a text note naming the `tool_call_id`, leaves user-attached images alone, and exposes two environment variables.

## Local comparison

- Call path: `open-sse/translator/request/openai-responses.js` `splitToolOutputImages` lifts `input_image` parts from `function_call_output` (custom outputs are rewritten to that type first) into `pendingToolImages`, which is flushed as a user message after each run of tool results. Before this change nothing bounded that list.
- Existing per-request image limits: none for count or total bytes on this path. The only image byte constant is the per-image `MAX_IMAGE_BYTES` (10 MB) in `open-sse/config/mediaConfig.js`, used for remote fetches and image-provider inputs.
- Existing capability policy: `stripUnsupportedModalities` (`open-sse/translator/concerns/modality.js`, called from `chatCore.js`) only inspected `input[].content`. Images inside `function_call_output.output` were not stripped for a `vision: false` model, so the translator re-injected them anyway.

## Local change

- `openai-responses.js`: fixed constants `MAX_TOOL_OUTPUT_IMAGES = 16` and `MAX_TOOL_OUTPUT_IMAGE_BYTES = 2 * MAX_IMAGE_BYTES` (reusing the existing per-image ceiling). `boundToolOutputImages` runs once over all lifted images after the input loop. Keeping is a strict newest-first prefix; older images become a text part, `[Earlier tool output image omitted to bound request size (tool_call_id: <id>)]`, at their original position, so surviving images and text keep history order. Tool-message text and user-attached images are untouched. The function's limit parameters exist for pure boundary tests; no environment variable or setting was added.
- `modality.js`: `stripResponses` now applies the existing vision policy to `function_call_output` / `custom_tool_call_output` arrays, replacing images with the existing `[Previous image omitted from context.]` / current-turn placeholder as an `input_text` part. Vision-capable models are unchanged.

## Rejected or not ported

- `OMNIROUTE_TOOL_OUTPUT_IMAGE_MAX_COUNT` / `..._MAX_BYTES` environment variables, `.env.example` and environment-reference entries, the changelog fragment, and the `TOOL_OUTPUT_IMAGE_CAP` warning log: configuration and integration surface this port was told not to add.
- Native same-format Responses dispatch to a vision-capable model keeps its media unchanged.

## Verification

Offline only: small synthetic data URLs and pure translation, no provider traffic or large payloads. From `tests/`:

`node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-responses-tool-image-bounds.test.js` — 11 tests: within-bounds order, count cap with in-place notes, user images preserved, exact-budget and one-over-budget boundaries, strict-prefix rule, oversized newest image, multi-image group order, vision-off strip, vision-on keep. The vision-off test fails with the `modality.js` change reverted.

Neighbouring suites also passed: `translator/openai-responses-tool-output-images`, `chat-responses-tool-output-media-1332`, `v5-conformance-tool-media-ceilings`, `has-media-blocks`, `bugs-codexCli-responses`, and eight files importing the modality module (110 tests).

Limit: size is measured as URL length, so remote URLs count as their string length, not the bytes a provider later fetches. The whole suite and live provider paths were not run.
