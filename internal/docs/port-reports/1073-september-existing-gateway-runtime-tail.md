# #1073 September gateway runtime tail

## Scope and pins

This review compares the public PR patches with the current local gateway implementation and offline fixtures. The two enclosing merge commits contain unrelated release changes, so their PR-specific commit subjects and changed paths are used where relevant.

| PR | Public head | Enclosing merge / pinned change | Public patch |
| --- | --- | --- | --- |
| [OmniRoute #14914](https://github.com/cheaper-inference/OmniRoute/pull/14914) | `1b26752e07416292a16b3c94bbb24c95c6288843` | `22751d0fcfd8af725b9645ff4eb133d3dfd5ac96` | [PR-specific commit](https://github.com/cheaper-inference/OmniRoute/commit/22751d0fcfd8af725b9645ff4eb133d3dfd5ac96) |
| [OmniRoute #14965](https://github.com/cheaper-inference/OmniRoute/pull/14965) | `16fa7c7197c04c40ce93dbd417d0746546976eba` | `4e843b8769db5a2350c28b1c3d70048181fcc909` | [PR-specific commit](https://github.com/cheaper-inference/OmniRoute/commit/16fa7c7197c04c40ce93dbd417d0746546976eba) |
| [OmniRoute #14929](https://github.com/cheaper-inference/OmniRoute/pull/14929) | `d20a03bab542ed3686832124ae6d48683713a2d6` | `1d84c4719d0b36a0cf0a052f98babcd7db1fd8b9` | [PR-specific commit](https://github.com/cheaper-inference/OmniRoute/commit/d20a03bab542ed3686832124ae6d48683713a2d6) |
| [OmniRoute #14940](https://github.com/cheaper-inference/OmniRoute/pull/14940) | `14137b7efacda6fa6c976703dcc9a2d446a7de86` | `5f267faf314c312695e86983b7a221f3bd46c83c` | [PR-specific commit](https://github.com/cheaper-inference/OmniRoute/commit/5f267faf314c312695e86983b7a221f3bd46c83c) |

## Current local behavior and fixture evidence

- **Empty turns:** `open-sse/handlers/chatCore.js` wraps streaming Antigravity/AGY responses with `createEmptyRetryStream` from `open-sse/handlers/chatCore/emptyStreamGuard.js`. `tests/unit/empty-stream-guard.test.js` covers thought-only output being forwarded live and byte-faithfully, followed by retry when a thought-only attempt ends with STOP. `tests/unit/agy-empty-stream-chatcore.test.js` covers the chatCore integration. `tests/unit/empty-stream-terminal-1073.test.js` covers bounded draining after a provider terminal. The retry path re-executes the existing provider request and preserves its established retry/exhaustion boundary.
- **Reasoning:** Thought-only data is not meaningful answer content for the empty-stream classifier, while reasoning remains streamed as received. The fixture explicitly records that both the discarded attempt's reasoning and the retry's reasoning can reach the client in the same message. Existing reasoning preservation and effort coverage includes `tests/unit/thinking-suffix-chatcore.test.js`, `tests/unit/opencode-free-reasoning-port.test.js`, and `tests/unit/qoder-reasoning-effort.test.js`.
- **Stream readiness:** The current `chatCore.js` flow performs stream preparation/readiness before handing responses to the downstream stream path; the empty-turn guard separately bounds terminal drain and stalled reads. `tests/unit/stream-early-eof-failover.test.js` covers retrying an empty stream before any byte reaches the client. These are distinct contracts: first-byte readiness does not redefine an already-started empty-turn retry, tool output, or retry budget.

## Disposition by PR

### #14914 — separate upstream empty-turn retry credential rollback

The public patch extracts a flush-empty retry loop and restores the original credential object if a replacement credential's retry is rejected; it also adopts the retry body only after acceptance. The relevant upstream path is the translated flush-empty retry path in `chatCore.ts`, with its dedicated credential-rollback fixtures. The local runtime's `createEmptyRetryStream` is a separate Antigravity/AGY in-stream retry policy: it re-executes the request and judges empty output after streaming. No matching local flush-empty translated retry loop or local reproduction of the rejected-retry credential mutation is present in the inspected `chatCore.js` path. **Disposition: not an installed repair; keep as an upstream-only candidate.** No narrow local gap is demonstrated by the existing behavior or fixtures, so no acceptance test is proposed here.

### #14965 — per-provider system transforms

This patch adds provider-scoped system transforms in the upstream CC bridge and applies them in chatCore for non-Claude providers. That is source-only bridge/transform behavior, not an existing empty-turn, reasoning, or stream-readiness repair. Local chatCore has no matching per-provider CC bridge transform seam in the inspected request path, and existing system-injection fixtures cover different behavior. **Disposition: source-only driver/transform change; exclude from this gateway runtime tail.** No narrow gap established.

### #14929 — preserve `xhigh` in command-code effort mapping

The PR-specific patch only renames a changelog fragment; the described effort fix is outside that one-line rename. Current local effort handling has direct `xhigh` evidence in `tests/unit/qoder-reasoning-effort.test.js` and `tests/unit/thinking-suffix-chatcore.test.js`, but the rename itself changes no runtime request or response behavior. **Disposition: changelog-only public head; no runtime repair to port.**

### #14940 — cap opt-in OpenCode Responses first-byte stall window

This patch changes the OpenCode executor's opt-in first-byte stall rotation guard and adds a readiness-timeout ceiling plus timing/logging behavior. The executor and option are specific to the upstream OpenCode implementation; the local inspected OpenCode executor does not expose the same `RESPONSES_FIRST_BYTE_TIMEOUT_MS` / stall-rotation mechanism. Current readiness and empty-turn contracts are already covered independently by the fixtures listed above. **Disposition: source-only driver plus added timeout option/timing; not an installed gateway repair.** No local narrow gap is demonstrated.

## Acceptance

No product change is justified by these four exact public patches against the inspected local gateway contracts. Accordingly there is no new offline acceptance test to add in this report-only review. If a future scoped change introduces a matching flush-empty translated retry or Responses stall guard, acceptance should use deterministic mocked streams and credentials to assert rejected-retry credential restoration, accepted-retry adoption, preserved tool output, unchanged retry limits, and readiness-bound timing without live provider traffic.
