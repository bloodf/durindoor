# #1073: Late May Kiro and Responses replay comparison

## Scope and evidence

Compared the exact first-parent merged patches in the local OmniRoute source
repository `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` with the
current DurinDoor implementation. The pinned merge commits and their PR heads
are listed below; titles and path similarity were not treated as runtime
evidence.

Local behavior was traced through current translator and stream code and its
focused checked-in tests. The test runner could not be executed in this
worktree: `tests/node_modules/vitest/vitest.mjs` is absent. No dependencies were
installed. Thus the behavior statements below are source-backed, and the cited
tests specify the intended local assertions, but there is no fresh passing test
run for this report.

## OmniRoute #2447 — Kiro tool-result content

- PR head: `12ab83a45dff0a24512ff16a952df348c5d10f0b`
- First-parent merge: `52903fea74bac343beb865f3e4127a2d75290ac4`
- Pinned patch: [openai-to-kiro.ts](https://github.com/cheaper-inference/OmniRoute/blob/52903fea74bac343beb865f3e4127a2d75290ac4/open-sse/translator/request/openai-to-kiro.ts)
- Current counterpart: [openai-to-kiro.js](../../../open-sse/translator/request/openai-to-kiro.js)
- Relevant local tests: [bugs-kiro.test.js](../../../tests/translator/bugs-kiro.test.js)

**Disposition: ready scoped remaining fix — preserve tool-result block content.**

The pinned patch adds a serializer for string, structured, image, and other
tool-result content, using a non-empty placeholder for empty output. Current
DurinDoor conversion at `openai-to-kiro.js` handles Claude `tool_result` array
content with `c.text || ""`, and OpenAI `role: "tool"` content only when it is
a string. As a result, image blocks and JSON blocks become empty result text;
the local existing code does not demonstrate preservation of those values.
This is a narrowly scoped content repair. Preserve the current wire schema
(`toolResults[].content[].text`) and do not forward unsupported native blocks.

The patch's `is_error` to Kiro `status: "error"` mapping is already present in
both current result paths. The incoming tool call ID is also retained when
supplied. The pinned patch's deterministic fallback ID changes only missing-ID
tool calls; no need to replace caller IDs. Any fallback change should retain
the current schema and be separately justified with collision/history evidence.

## OmniRoute #2630 — Kiro conversation identity after compression

- PR head: `ec639fe908e7ca374c4935ffeeeffff3362c10a0`
- First-parent merge: `b150b5f772d972e770d8ff6e4c24eea63384f8bc`
- Pinned patch: [openai-to-kiro.ts](https://github.com/cheaper-inference/OmniRoute/blob/b150b5f772d972e770d8ff6e4c24eea63384f8bc/open-sse/translator/request/openai-to-kiro.ts), [chatCore.ts](https://github.com/cheaper-inference/OmniRoute/blob/b150b5f772d972e770d8ff6e4c24eea63384f8bc/open-sse/handlers/chatCore.ts)
- Current counterparts: [openai-to-kiro.js](../../../open-sse/translator/request/openai-to-kiro.js), [sessionManager.js](../../../open-sse/utils/sessionManager.js), [kiro-session-affinity.test.js](../../../tests/unit/kiro-session-affinity.test.js)

**Disposition: already covered; do not replay the upstream mechanism.**

The pinned patch captures the pre-compression first user text and uses it as a
deterministic conversation-ID seed. Current Kiro payload construction instead
uses `translationContext.clientSessionId` or `resolveSessionId`, with request
headers, body, connection ID, and Kiro scope as inputs. That identity is not
derived from compressed message text. The local session-affinity test asserts
that stable session IDs are carried through the Kiro payload and that
deprecated agent fields are absent. Replacing this with a content-derived ID
would change identity semantics and is not needed to survive prompt
compression.

## OmniRoute #2647 — Copilot Responses reasoning for Claude

- PR head: `00f135f99683a896f997f2b317861a4c2c67fd8c`
- First-parent merge: `fb4ac6fb84a18274944dda2459de8cf260d737d1`
- Pinned patch: [openai-responses.ts](https://github.com/cheaper-inference/OmniRoute/blob/fb4ac6fb84a18274944dda2459de8cf260d737d1/open-sse/translator/request/openai-responses.ts), [openai-to-claude.ts](https://github.com/cheaper-inference/OmniRoute/blob/fb4ac6fb84a18274944dda2459de8cf260d737d1/open-sse/translator/request/openai-to-claude.ts), [claudeCodeCompatible.ts](https://github.com/cheaper-inference/OmniRoute/blob/fb4ac6fb84a18274944dda2459de8cf260d737d1/open-sse/services/claudeCodeCompatible.ts)
- Current counterparts: [openai-responses.js](../../../open-sse/translator/request/openai-responses.js), [openai-to-claude.js](../../../open-sse/translator/request/openai-to-claude.js), [responsesSequenceReplay.js](../../../open-sse/utils/responsesSequenceReplay.js), [responses-sequence-replay.test.js](../../../tests/unit/responses-sequence-replay.test.js)

**Disposition: incompatible with this replay/content scope; exclude.**

This patch forwards a Copilot user-agent marker through request translation,
promotes Responses `reasoning.effort` into chat reasoning fields, and requests
Claude summarized thinking display. It changes client-specific reasoning
behavior; it does not repair event history ordering, duplicate content replay,
or tool-result content. The requested exclusions rule out adding the Copilot
marker and related behavior here. Existing compatible Responses translation
and native paths remain intact.

For replay behavior, current DurinDoor has the distinct
`createResponsesSequenceReplayTracker` path, used by both translated and
passthrough Responses stream handling. Its local tests assert suppression of
duplicate sequence-numbered deltas and preservation of terminal, usage, and
`[DONE]` delivery. This is an existing, separate replay implementation, not
evidence for importing the reasoning patch.

## Demonstrated local behavior summary

| Area | Current behavior evidenced in source/tests | Disposition |
| --- | --- | --- |
| Kiro tool-result `is_error` | Converts to `status: "error"` in both Claude-block and OpenAI tool-role paths. | Already covered |
| Kiro tool-result content | String and text blocks are handled; non-text array blocks and non-string OpenAI tool results are discarded. | Ready scoped remaining fix |
| Kiro conversation identity | Session/context identity comes from the resolved client/session path, not the compressed first user text. | Already covered; keep current semantics |
| Responses replay | Per-response sequence watermark suppresses duplicate replay while retaining terminal/usage events; tests cover translated and passthrough paths. | Already covered |
| Copilot Responses reasoning | Upstream adds Copilot-specific reasoning promotion/display behavior. | Incompatible change; exclude |

Fresh runtime test execution was not possible because Vitest dependencies are
not installed in this worktree. The attempted focused command failed before
collection with `MODULE_NOT_FOUND` for `tests/node_modules/vitest/vitest.mjs`.
