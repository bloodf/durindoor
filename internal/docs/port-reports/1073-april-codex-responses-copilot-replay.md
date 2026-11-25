# 1073: Codex defaults and Copilot Responses replay

Compared against the local public source mirror on 2026-11-21. Exact PR heads were inspected directly; enclosing merge commits are recorded to distinguish each PR from unrelated changes in its release merge.

## Pins and dispositions

| PR | Exact head | Enclosing merge | Disposition |
|---|---|---|---|
| [OmniRoute #1750](https://github.com/cheaper-inference/OmniRoute/pull/1750) | `b4b2583e8a71cc5984bc5d13560ee3247194b663` | `71486566525748d72c9cf38ae1dec7c52d9907b6` | **Adapt replay behavior; focused gap remains.** |
| [OmniRoute #1778](https://github.com/cheaper-inference/OmniRoute/pull/1778) | `b27cb9fba16cfc3c97c706fddc3a09cc151b12de` | `5b0ac4266e9c9843656bf5eeffaa183cf2bd8045` | **Already covered in part; no replay port.** Its exact PR is the browser-safe Codex defaults extraction, not the unrelated identity alignment also visible in the enclosing merge. |
| [OmniRoute #1791](https://github.com/cheaper-inference/OmniRoute/pull/1791) | `868ad39db1551848d2356219170674f7f3eaed09` | `df5b4618bf7e4c6208fadb58f88888f6ab62117b` | **Adapt replay behavior; focused gap remains.** |

Patch links: [#1750 exact head diff](https://github.com/cheaper-inference/OmniRoute/commit/b4b2583e8a71cc5984bc5d13560ee3247194b663), [#1778 exact head diff](https://github.com/cheaper-inference/OmniRoute/commit/b27cb9fba16cfc3c97c706fddc3a09cc151b12de), [#1791 exact head diff](https://github.com/cheaper-inference/OmniRoute/commit/868ad39db1551848d2356219170674f7f3eaed09). These commit destinations resolve to the specified pins; merge links are [#1750 merge](https://github.com/cheaper-inference/OmniRoute/commit/71486566525748d72c9cf38ae1dec7c52d9907b6), [#1778 merge](https://github.com/cheaper-inference/OmniRoute/commit/5b0ac4266e9c9843656bf5eeffaa183cf2bd8045), and [#1791 merge](https://github.com/cheaper-inference/OmniRoute/commit/df5b4618bf7e4c6208fadb58f88888f6ab62117b).

## What the patches do

- **#1750** separates Responses behavior from Codex executor defaults. It strips unsupported `truncation`, remembers completed Responses `function_call` items by response id, restores missing calls on follow-up requests carrying `function_call_output`, synthesizes missing reasoning-summary stream events from completed reasoning items, and avoids appending Chat-style `[DONE]` to a Responses stream. Its cache is bounded (512 entries, 30-minute TTL) and is populated from completed passthrough output items.
- **#1778** moves browser-safe Codex client defaults into `codexIdentity.ts` and leaves the Node crypto identity creation code outside the browser-safe defaults module. This is a module-boundary change and does not introduce Copilot Responses replay. The exact head must be kept distinct from the larger enclosing merge, whose title describes identity metadata and whose patch includes unrelated changes.
- **#1791** extends replay state from function calls to full response conversation items, adds recovery by globally remembered call ids, filters unmatched call/output records, and uses a recovery message when filtering would leave no input. It also adjusts chatCore to retain the final transformed request body for stream state. These are replay/correlation changes, separate from client default identity.

## Current tree comparison

Current Codex request handling already converts system messages to developer messages and normalizes assistant history text parts to `output_text` in [codex.js](../../../open-sse/executors/codex.js). It strips `previous_response_id` and several unsupported parameters, including `truncation` in its general allowlist filtering. The request-local Codex fingerprint identity and transient-credential cleanup are implemented in [codexIdentity.js](../../../open-sse/config/codexIdentity.js); these cover identity/default isolation, not tool replay.

The existing stream path has per-request stream state and existing terminal/usage cleanup, but no cross-request response-id-to-tool-call cache or conversation snapshot. In particular, current ordinary input cleanup does not reconstruct an omitted `function_call` when a request has a matching `function_call_output`, nor can it recover a prior turn omitted from the submitted history. Stripping `previous_response_id` therefore loses that server-side continuation context. This is the focused gap demonstrated by #1750/#1791. Existing local tool-pairing logic in [responses-historical-tool-pairing.test.js](../../../tests/unit/responses-historical-tool-pairing.test.js) concerns translator-produced historical inputs; it does not supply the prior response snapshot to native Codex passthrough. Current Codex identity fixtures in [codex-identity.test.js](../../../tests/unit/codex-identity.test.js) prove identity behavior only.

The #1750/#1791 stream additions concern Responses passthrough framing and remembered output items; they are not implied by current per-request stream state or ordinary context cleanup. Existing response stream tests such as [responses-transform-stream.test.js](../../../tests/unit/responses-transform-stream.test.js) and [responses-usage-trailing-6965.test.js](../../../tests/unit/responses-usage-trailing-6965.test.js) cover conversion and terminal/usage events, but do not establish Copilot follow-up replay. No browser was run. Static review of #1778 confirms its split is about keeping defaults importable without Node-only identity creation; it does not address the replay state gap.

## Focused offline acceptance for the demonstrated gap

If implementing the replay port, add ordinary offline unit coverage for: a streamed completed response with multiple function calls followed by outputs; restoring only missing calls for the matching `previous_response_id`; no duplicate calls when the request already contains them; unknown, expired, and evicted response ids; bounded cleanup; malformed/missing call ids and orphan call/output filtering; snapshot replay ordering and no duplicate context; an empty-after-filtering recovery case; normal user-only follow-up input; Responses stream completion without a Chat `[DONE]`; and reasoning-summary synthesis only when the upstream omitted corresponding summary events. Keep provider traffic, browser execution, and end-to-end tests out of this acceptance. A separate focused fixture should assert Codex default normalization/unsupported-parameter behavior independently of replay state.

## Local evidence

- Current source: [Codex executor](../../../open-sse/executors/codex.js), [Codex identity helper](../../../open-sse/config/codexIdentity.js), and [chat core](../../../open-sse/handlers/chatCore.js).
- Existing fixtures: [Codex identity](../../../tests/unit/codex-identity.test.js), [Responses historical tool pairing](../../../tests/unit/responses-historical-tool-pairing.test.js), [Responses transform stream](../../../tests/unit/responses-transform-stream.test.js), and [Responses trailing usage](../../../tests/unit/responses-usage-trailing-6965.test.js).
- Source patches and merge statistics were read from the supplied local public source mirror, using the exact PR heads above rather than treating the broader release merges as PR diffs.

No product or test files were changed, and no tests or browser were run for this documentation-only comparison.
