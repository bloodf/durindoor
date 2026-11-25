# #1073: Existing Claude stream shape comparison

## Pins and scope

This comparison uses the requested public patch pins, not the unrelated changes in their enclosing merges:

| PR | Patch head | Enclosing merge |
| --- | --- | --- |
| [OmniRoute #290](https://github.com/cheaper-inference/OmniRoute/pull/290) | [`8a7f7c1ba08619875368fe55b282a29d7e82272f`](https://github.com/cheaper-inference/OmniRoute/commit/8a7f7c1ba08619875368fe55b282a29d7e82272f) | [`4f11762c68d6554cb58b4d46bd32ad4ac306baa7`](https://github.com/cheaper-inference/OmniRoute/commit/4f11762c68d6554cb58b4d46bd32ad4ac306baa7) |
| [OmniRoute #663](https://github.com/cheaper-inference/OmniRoute/pull/663) | [`e88d260acd35df730e9fa506c0c6a2d42b12def4`](https://github.com/cheaper-inference/OmniRoute/commit/e88d260acd35df730e9fa506c0c6a2d42b12def4) | [`9ba4f966db4cb296fe4e1b84713eb5e69903208f`](https://github.com/cheaper-inference/OmniRoute/commit/9ba4f966db4cb296fe4e1b84713eb5e69903208f) |
| [OmniRoute #676](https://github.com/cheaper-inference/OmniRoute/pull/676) | [`34e3174c9b5268ade14a0d9ede0994197ba6b516`](https://github.com/cheaper-inference/OmniRoute/commit/34e3174c9b5268ade14a0d9ede0994197ba6b516) | [`63e42047e3394afa424aee341229bca9e6ca7ea7`](https://github.com/cheaper-inference/OmniRoute/commit/63e42047e3394afa424aee341229bca9e6ca7ea7) |

For #663, the reviewed Claude-specific patch is the first-parent delta of merge `9ba4f966...` (chat-core Claude tool-name restoration, stream passthrough restoration, and its added fixture). The supplied head `e88d260...` is itself a merge; its broad merge result includes unrelated upstream edits. #676's supplied head is the helper/test change; its enclosing merge also carries unrelated project edits.

## Current local evidence

- [`claude-to-openai.js`](../../../open-sse/translator/response/claude-to-openai.js) already emits Claude `thinking_delta` as OpenAI `reasoning_content`, tracks thinking block boundaries without inserting `<think>` / `</think>` into visible content, and handles tool-use blocks and argument deltas as OpenAI tool calls. `tests/unit/claude-reasoning-response.test.js` covers reasoning-vs-content shape and thinking usage; `tests/unit/claude-decloak-response-boundary.test.js` covers streamed and non-streamed tool-name restoration. The translator also merges `message_start` cache counts with `message_delta` output counts and maps stop reasons to OpenAI finish reasons. These current cache, usage, and terminal behaviors are broader than #290's small thinking-field patch and must remain intact.
- Claude native passthrough is separately exercised by `tests/unit/claude-passthrough-decloak.test.js`: fixtures cover `content_block_start` `tool_use` name restoration, non-tool blocks, absent/stale maps, preserved native `message_start` / `content_block_delta` / `message_delta` / `message_stop` frames, and no OpenAI `[DONE]` terminator. The generic stream setup accepts a tool-name map, and the stream layer decloaks native tool-use names. This is the behavior relevant to #663's native passthrough tool handling. Its nearby translator-side change to disable prefixing during normalization belongs to the Claude OAuth/provider request path; do not treat every surrounding chat-core/provider change in the merge as part of this narrow response-shape comparison.
- [`streamHelpers.js`](../../../open-sse/utils/streamHelpers.js) already retains non-empty OpenAI content, reasoning, tool-call, image, role and finish chunks, and rejects an empty Claude `content_block_delta`. It does so with truthiness expressions, whereas #676 made type and length checks explicit and returned booleans. For valid ordinary stream fixtures these have the same intended acceptance result. The explicit guards mainly change malformed/non-string field handling; no local Claude stream fixture demonstrates a user-visible omission from that difference. Existing `tests/unit/port-3521-generated-image-stream.test.js` protects the nearby OpenAI image-delta case.

## Disposition

| PR | Disposition | Reason |
| --- | --- | --- |
| #290 | Already covered; no port | The exact thinking-delta shape is present locally and tested, with local reasoning helper, terminal, and usage/cache behavior preserved. |
| #663 | Already covered for native response tool names; no port | Local passthrough fixtures exercise streamed native `tool_use` restoration and preservation of Claude event framing. Nearby request normalization/provider wiring is outside the demonstrated response-shape gap and requires separate scope evidence before consideration. |
| #676 | No demonstrated narrow gap; no port | Current helper handles ordinary valid Claude and OpenAI chunks; the patch's explicit type/boolean checks only differ on malformed field values not shown by the ordinary local fixtures. Its generic helper-wide semantic change is not justified by a Claude-specific fixture gap here. |

## Ordinary offline acceptance

For this report-only comparison, acceptance is inspection of the existing offline fixtures named above: `claude-reasoning-response.test.js`, `claude-decloak-response-boundary.test.js`, `claude-passthrough-decloak.test.js`, and `port-3521-generated-image-stream.test.js`. No additional test is proposed because no narrow missing behavior was demonstrated by these patches against current source and fixtures.
