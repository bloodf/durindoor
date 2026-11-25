# Port batch 17, part 2: candidates 9-16

The source report, [open-prs-nov25-17.md](open-prs-nov25-17.md), has 14 port-candidate rows. Candidates 9-16 in table order are therefore six rows: 9-14. All are `decolua/9router` pull requests. On 2026-11-25 each current head matched the SHA in the source report.

"Upstream tests passed" means the PR's own test file, taken at that head, ran unchanged as a temporary local file with outbound sockets blocked. Those temporary files are not committed.

| Row | PR | Head SHA | Disposition | Evidence |
|---:|---|---|---|---|
| 664 | #2761 | `ca25c6ec1560cce410af8c1af78abb0296fb1110` | Ported in this change | Before the change, a Claude to OpenAI to Claude probe lost the assistant thinking signature. Claude-source requests now target the Claude format in [chatCore.js](../../../open-sse/handlers/chatCore.js), selected by a quirk in [github.js](../../../open-sse/providers/registry/github.js) that GitHub Enterprise Copilot shares. Coverage: [port-2761-github-claude-native-route.test.js](../../../tests/unit/port-2761-github-claude-native-route.test.js). |
| 666 | #2756 | `3ddf918f29f0772b7c1c820b0d8378f88a8ae113` | Already present | Commit `9e317ad5fcb` added the token-count preflight to [github.js](../../../open-sse/executors/github.js), covered by [github-prompt-limit-preflight.test.js](../../../tests/unit/github-prompt-limit-preflight.test.js). The `context_length_exceeded` code is kept, covered by [port-5280-copilot-context-overflow.test.js](../../../tests/unit/port-5280-copilot-context-overflow.test.js). See the note on limit metadata below. |
| 670 | #2747 | `20b38fa46e8d24666687545a919b0650d30ba582` | Already present | Both [openai-responses.js](../../../open-sse/translator/response/openai-responses.js) and [responsesTransformer.js](../../../open-sse/transformer/responsesTransformer.js) allocate `nextOutputIndex`. Upstream tests passed. Local coverage: [omni-responses-output-index-stability.test.js](../../../tests/unit/omni-responses-output-index-stability.test.js). |
| 673 | #2731 | `15ed7b9602867784e8550fa5a1dea5eb3ac12920` | Already present | The PR removes ellipsis and future-action text heuristics. A `git log -S` search of `open-sse` for `SHORT_FUTURE_ACTION` and the retry error code returns nothing. In [kiro.js](../../../open-sse/executors/kiro.js), the integrity retry for a streamed turn is for a malformed tool-call wrapper, not answer wording. [kiro-one-shot-toolcall-repair.test.js](../../../tests/unit/kiro-one-shot-toolcall-repair.test.js) passes. The upstream test file did not finish against this executor within the time limit and is not used as evidence. |
| 677 | #2713 | `8817537ba0a7b9b0b8dc877f832827d92933de2a` | Ported in this change (two behaviours) | Interleaved argument deltas merged into the latest call when correlated by `call_id` or `output_index`; fixed in [openai-responses.js](../../../open-sse/translator/response/openai-responses.js). A same-format stream forwarded a second lifecycle terminal; fixed in [stream.js](../../../open-sse/utils/stream.js). Coverage: [port-2713-responses-reconstruction.test.js](../../../tests/unit/port-2713-responses-reconstruction.test.js). Parts not taken are listed below. |
| 680 | #2706 | `6c9ab1d17fd2b4858359738c1eb5852ffc987011` | Already present | [minimax.js](../../../open-sse/providers/registry/minimax.js) and [minimax-cn.js](../../../open-sse/providers/registry/minimax-cn.js) set `ensureThinkingSignature`, applied in [stream.js](../../../open-sse/utils/stream.js). Upstream tests passed. No committed local test names this quirk. |

## Behaviour of the #2761 port

- OpenAI and Responses clients keep the executor's translation and stream conversion.
- A Claude-source request uses the same `/v1/messages` dispatch, with its retry policy and token preflight. It keeps the negotiated `stream` value and returns the upstream response unchanged.
- Only the fields in `GITHUB_MESSAGES_BODY_FIELDS` ([github.js config](../../../open-sse/config/github.js)) are forwarded. `context_management`, `metadata` and other fields outside the list stay off the wire.
- The existing Copilot rule that drops reasoning for Claude models other than Opus and Sonnet 4.6 still applies, including `output_config.effort`. Those requests keep signed history but send no thinking configuration.
- A Claude user turn that holds only tool results sends `X-Initiator: agent`. Upstream does not handle this shape, so its change would have marked tool continuations as user-initiated.
- Nested tool and content-block fields are not filtered. No request was sent to live Copilot, so its acceptance of the native body is unverified here.

## Parts not taken

- #2756: upstream also sets static limits of 264K context, 200K prompt and 64K output for three Copilot Claude models, and normalizes limits from the live catalog. DurinDoor still reports its generic Claude limits for those models, while dispatch enforces the 200K prompt cap.
- #2713, forced JSON: upstream turns a failed response into a successful completion with an `[Error]` suffix. DurinDoor keeps it a failure. Upstream also drops the partial tool call from an incomplete Gemini-shaped result; DurinDoor keeps it.
- #2713, same-format streaming: upstream rewrites an empty `response.completed.output` and adds partial output to synthesized `response.failed` events. DurinDoor forwards upstream terminal frames as received and does not do either.
- #2713, ordering: argument deltas that arrive before their `response.output_item.added` event are still not buffered.
- #2713, already present: no failure terminal is added after an accepted one on abort; [streamTerminal.js](../../../open-sse/utils/streamTerminal.js) returns no recovery bytes then.
