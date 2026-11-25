# #1073 — Existing Claude tool remap metadata and adjacency

Scope: request-local tool-name bookkeeping, Claude tool-use/result adjacency, and ordinary Claude protocol flags on installed routes. Excludes provider-profile registration, account identities, credentials, sign-in, and new clients. Upstream review is pinned to named PR commits; merge commits are cited only to identify their integration context.

## Upstream pins

| PR | Exact named patch | Enclosing merge / integration | Public evidence |
| --- | --- | --- | --- |
| OmniRoute #2254 | head [`e244fd51d40cc318152f8419d2bcb43780039fe2`](https://github.com/cheaper-inference/OmniRoute/commit/e244fd51d40cc318152f8419d2bcb43780039fe2), parent `c6f5b394f8d98dc4b148a6db8fe043842a055579` | [`e1a6ecf238d38b637f3c06ef9ac429ec7c9fcb8a`](https://github.com/cheaper-inference/OmniRoute/commit/e1a6ecf238d38b637f3c06ef9ac429ec7c9fcb8a) | [PR #2254](https://github.com/cheaper-inference/OmniRoute/pull/2254) |
| OmniRoute #2312 | head [`6d85c5a501fd31f155515addacd84c3c9feef5c9`](https://github.com/cheaper-inference/OmniRoute/commit/6d85c5a501fd31f155515addacd84c3c9feef5c9) is the release merge; named PR patch [`8eb721ec314ba66befc56899cd3c62cdbd6a5209`](https://github.com/cheaper-inference/OmniRoute/commit/8eb721ec314ba66befc56899cd3c62cdbd6a5209), parent `ebef1648be165bad707d6236ec0216fb360bc61d` | [`8eb721ec314ba66befc56899cd3c62cdbd6a5209`](https://github.com/cheaper-inference/OmniRoute/commit/8eb721ec314ba66befc56899cd3c62cdbd6a5209), integrated into release/v3.8.0 | [PR #2312](https://github.com/cheaper-inference/OmniRoute/pull/2312) |
| OmniRoute #2568 | head [`4cef003b09c3af5841bfab6f3409e45592fb5461`](https://github.com/cheaper-inference/OmniRoute/commit/4cef003b09c3af5841bfab6f3409e45592fb5461), parent `1ab87fa9a572f11e2ea4250d1a03887376697cc8` | [`2fd527583320ddd66226fedc04fc2d6a62a1c19f`](https://github.com/cheaper-inference/OmniRoute/commit/2fd527583320ddd66226fedc04fc2d6a62a1c19f) | [PR #2568](https://github.com/cheaper-inference/OmniRoute/pull/2568) |

For #2312, the supplied head is a release merge containing unrelated changes. The comparison uses the named patch commit and its `open-sse/executors/base.ts`, `open-sse/services/claudeCodeCompatible.ts`, `open-sse/services/contextManager.ts`, and `tests/unit/cc-bridge-tool-pair-guard.test.ts` changes, not the release merge's first-parent aggregate.

## Findings and disposition

### #2254 — keep request remap metadata off the wire

The patch replaces a request-wide `_claudeCodeRequiresLowercaseToolNames` boolean with a per-request `Map` from remapped upstream name to caller name. It attaches `_toolNameMap` as non-enumerable request-local metadata, accumulates mappings from definitions, assistant `tool_use`, and forced `tool_choice`, and uses those mappings to restore response names. Its tests assert the metadata survives in memory but is absent from `Object.keys` and `JSON.stringify`.

The local implementation has the same boundary. [`claudeCodeToolRemapper.js`](../../../open-sse/services/claudeCodeToolRemapper.js) keeps `_toolNameMap` non-enumerable and tracks request remaps; [`openai-to-claude.js`](../../../open-sse/translator/request/openai-to-claude.js) also carries a request-local alias map for translated tool names. The GitHub Claude executor explicitly reads and deletes `_toolNameMap` before serializing the strict upstream request and carries the map into response state ([`github.js`](../../../open-sse/executors/github.js)). Existing fixtures assert serialization safety in [`opencode-v2-free-tier.test.js`](../../../tests/unit/opencode-v2-free-tier.test.js), response name restoration and Claude name normalization in [`port-10392-claude-tool-name-pascalcase.test.js`](../../../tests/translator/port-10392-claude-tool-name-pascalcase.test.js), and map behavior in [`claude-kiro-direct.test.js`](../../../tests/translator/claude-kiro-direct.test.js).

**Disposition: already covered.** No narrow gap demonstrated; no additional acceptance test is proposed.

### #2312 — orphan tool-use/result guards

The named patch exports a context-pruning helper and adds a send-boundary pass to the base Claude executor and Claude-compatible bridge. It removes unmatched historical tool calls and strips a trailing assistant tool-use that cannot have a following result. The new fixture checks paired history preservation, orphan removal, trailing call removal, and idempotence.

Local request preparation already handles Claude-specific adjacency. [`claude.js`](../../../open-sse/translator/formats/claude.js) runs `fixToolUseOrdering`, then `ensureTrailingUserTurn`; its preceding pairing pass validates each user `tool_result` against the immediately previous assistant tool-use and demotes unmatched results to text rather than emitting an invalid structured reference. Existing [`v5-1335-tool-result-pairing.test.js`](../../../tests/translator/v5-1335-tool-result-pairing.test.js) covers normal pairing, result reordering by call ID, missing-result synthesis, and cross-turn duplicates. Direct Claude-to-Kiro has explicit orphan-shape fixtures in [`claude-kiro-direct.test.js`](../../../tests/translator/claude-kiro-direct.test.js); broader orphan salvage is covered in [`port-2237-salvage-orphans.test.js`](../../../tests/translator/port-2237-salvage-orphans.test.js).

The upstream send-boundary detail is not identical: #2312 deliberately strips a trailing assistant `tool_use`; local translated Claude preparation preserves a final assistant turn as part of `ensureTrailingUserTurn`/assistant-prefill policy, and the reviewed fixtures do not establish a missing same-route send-boundary case for every installed native passthrough. This is a narrow candidate gap only where a native Claude passthrough can reach an upstream with a terminal unpaired assistant tool-use after normalization.

**Disposition: partial; ordinary offline acceptance recommended for the narrow terminal case.** Add offline fixture coverage at the shared Claude preparation boundary and native passthrough boundary: paired terminal history remains intact; an unmatched trailing assistant `tool_use` is removed or made send-valid; trailing assistant text/thinking and client prefill policy are preserved; request preparation remains idempotent. Do not add live-provider traffic or alter provider identity/credential behavior. This report does not implement that behavior change.

### #2568 — Sonnet context-window beta eligibility

The exact patch narrows `CONTEXT_1M_SUPPORTED_MODELS` in `claudeCodeCompatible.ts` from a list including Sonnet models to Opus models, with test adjustments for the beta header. This changes model-specific beta eligibility; it does not change tool remap metadata, tool-use/result adjacency, or an ordinary Messages protocol flag. The upstream commit also carries executor/identity-related files, which are outside this comparison.

Local ordinary Claude tool behavior is represented in [`openai-to-claude.js`](../../../open-sse/translator/request/openai-to-claude.js) and [`claude.js`](../../../open-sse/translator/formats/claude.js): OpenAI `parallel_tool_calls: false` lowers to Claude `tool_choice.disable_parallel_tool_use`, and preparation preserves/normalizes that flag. Offline assertions cover this behavior in [`v5-conformance-matrix-responses.test.js`](../../../tests/translator/v5-conformance-matrix-responses.test.js), [`v5-conformance-parallel-limits.test.js`](../../../tests/translator/v5-conformance-parallel-limits.test.js), and [`public-route-tool-conformance-1089.test.js`](../../../tests/unit/public-route-tool-conformance-1089.test.js). The 1M context beta is not treated as an ordinary protocol flag in this audit.

**Disposition: out of scope; no port.** The patch demonstrates a model capability / beta-header policy decision, not a gap in existing tool wire metadata or adjacency. Existing ordinary parallel-tool-use behavior has offline coverage.
