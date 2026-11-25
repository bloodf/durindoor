# #1073 late June: existing Kiro wire-tail review

## Pins and review scope

This review compares the exact public PR heads with the current DurinDoor source and offline fixtures. For each PR, the named head is the patch under review; the enclosing merge is recorded for provenance because it can include unrelated changes.

| PR | Exact head | Enclosing merge | Patch under review |
| --- | --- | --- | --- |
| [OmniRoute #4816](https://github.com/cheaper-inference/OmniRoute/pull/4816) | `177c12953285422b914abe10b1e7635b42605c89` | `7193b5fa13f3acc8e3d40dabc1b883441d823e43` | `open-sse/translator/request/openai-to-kiro.ts` rejects a model containing `[1m]`; adds positive and negative payload-construction tests. |
| [OmniRoute #4855](https://github.com/cheaper-inference/OmniRoute/pull/4855) | `e684e746e3486deda0344d2354715051dfd8bfb5` | `41b761b666b404f57adccffae6bbcdbf5c332d77` | `open-sse/executors/kiro.ts` buffers object-form tool inputs until a terminal boundary while emitting string deltas incrementally; adds executor-focused regression fixtures. |
| [OmniRoute #5303](https://github.com/cheaper-inference/OmniRoute/pull/5303) | `25ec2f1a47d9f9d6c89ae451060e7809c09a6c51` | `c0f1ee22004e85b89c39739ab82ed03b21d958b8` | `open-sse/translator/request/openai-to-kiro.ts` changes the synthesized assistant-tail user text from `Continue` to `...`; adds tests for assistant and tool-result tails. |

The public patch links above identify the PRs; the exact pinned commits identify the reviewed diffs. No enclosing-merge diff is used as a substitute for the named PR patch.

## Current behavior and offline evidence

### Context suffix boundary

The current Kiro request translator resolves only its local `-thinking` and `-agentic` model variants before building the payload. `resolveKiroModel(model)` supplies the resulting upstream ID at [openai-to-kiro.js](../../../open-sse/translator/request/openai-to-kiro.js); the Kiro synthetic-variant helper strips those two suffixes at [kiroVariants.js](../../../open-sse/providers/models/kiroVariants.js). There is no `[1m]` rejection in the Kiro request builder. Separately, [claude-context-markers-4762.test.js](../../../tests/unit/claude-context-markers-4762.test.js) locks the shared Claude Code boundary: only a proven 1M model is advertised with `[1m]`, decoding strips that marker for recognized routable aliases, and literal/unrecognized model IDs preserve it. That fixture is not evidence that Bedrock accepts the suffix.

The #4816 patch is narrowly an unsupported-suffix guard, not a new context tier. Its public test checks rejection for a `-thinking-agentic[1m]` name and ordinary model construction, but current offline fixtures do not reproduce a Kiro dispatch failure or establish the exact accepted spelling boundary. Avoid broad substring rejection or a context-tier/catalog change based only on that external assertion. A narrow follow-up, if chosen, should first specify whether the marker is a terminal suffix and exercise that exact boundary with an offline payload test.

### Streamed tool argument deltas

In current [kiro.js](../../../open-sse/executors/kiro.js), direct `toolUseEvent` handling JSON-stringifies every object-form `input` and emits it as a `tool_calls[].function.arguments` delta; it separately appends those emitted strings to `state.toolArgsEmitted`. Consecutive object snapshots such as `{"command":"cat /home"}` and `{"command":"cat /home/wxsys"}` therefore concatenate into invalid JSON. String-form inputs are emitted and appended as supplied, which is the expected concatenable-delta behavior and should stay incremental.

The exact #4855 public test [`kiro-tool-args-streaming.test.ts`](https://github.com/cheaper-inference/OmniRoute/blob/e684e746e3486deda0344d2354715051dfd8bfb5/tests/unit/kiro-tool-args-streaming.test.ts) models growing object snapshots and verifies that the final canonical object is emitted once; it also checks multiple calls, idempotent flush, empty buffers, and that concatenating every snapshot is invalid. In this fork, [kiro-one-shot-toolcall-repair.test.js](../../../tests/unit/kiro-one-shot-toolcall-repair.test.js) checks wrapper-fragment repair, not repeated direct object snapshots; [kiro-mitm-eventstream-pipeline.test.js](../../../tests/unit/kiro-mitm-eventstream-pipeline.test.js) checks Kiro EventStream framing, not upstream `toolUseEvent` to OpenAI argument reconstruction. Thus the implementation gap is visible in the current executor, while equivalent local regression coverage is absent.

### Ordinary alternating history and the synthetic tail

Current [openai-to-kiro.js](../../../open-sse/translator/request/openai-to-kiro.js) keeps all original turns in order when history ends in an assistant turn and appends a synthetic user current turn containing `Continue`. A real trailing user turn is promoted to `currentMessage`; a trailing tool result is kept on that real user turn.

Existing offline [omni-kiro-final-turn-history.test.js](../../../tests/unit/omni-kiro-final-turn-history.test.js) covers assistant tails, tool-call tails, completed tool exchanges, ordinary alternating user/assistant history, and real user/tool-result tails. It asserts original turn order, exactly-once content, and the existing `Continue` current turn. [omni-kiro-declared-tool-schema-current-message.test.js](../../../tests/unit/omni-kiro-declared-tool-schema-current-message.test.js) separately verifies caller-declared schemas survive on the current turn. These fixtures show the continuation is a synthetic protocol turn and do not reproduce an unintended Kiro action caused by the literal word `Continue`.

## Disposition

| PR | Disposition | Reason and scope |
| --- | --- | --- |
| #4816 | **Do not port from this evidence.** | Preserve the existing narrow model/context boundary. The local Claude marker fixture establishes recognized versus literal suffix handling, but not a Kiro-specific failure. If a future report demonstrates the exact bad Kiro wire ID, consider only a terminal `[1m]` guard with an offline boundary test; do not add model tiers or general suffix filtering. |
| #4855 | **Port the narrow object-snapshot fix.** | Current code emits each serialized object snapshot as a delta, so the concatenated arguments can be invalid. Buffer the latest object-form value per tool ID and emit it once at the existing completion boundary; leave string-form fragments concatenable and preserve per-call indexes. Ordinary offline acceptance should feed at least two growing object snapshots for one tool call through the Kiro executor, concatenate emitted `arguments`, and assert it parses to the final object; also cover multiple calls, a string-fragment sequence, and terminal flush idempotence. |
| #5303 | **Do not port without a reproduced gap.** | Existing fixtures explicitly cover the assistant-tail continuation and preserve ordinary alternating history and real tool-result turns. No offline fixture shows `Continue` triggering an unintended action. Changing the synthetic default based only on the upstream rationale is outside the reproduced gap requested for this audit. |

## Verification note

The focused offline command for the existing history, schema, wrapper-repair, and EventStream fixtures was attempted with `node node_modules/vitest/vitest.mjs run --config tests/vitest.config.js ...`. It could not start because this worktree has no root `node_modules/vitest/vitest.mjs` installed. No provider request, credential, sign-in, live traffic, or paid API was used.
