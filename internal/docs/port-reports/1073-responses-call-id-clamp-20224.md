# #1073: Responses long call-ID clamp (OmniRoute #20224)

Disposition: **port the `responses-call-id-clamp` member of #20224**. The other six members of that train are out of scope here; the Nov 24 post-cutoff commit intake (row for merge `713bf17cc7fd`, carried on the integration branch) and the [prior #20963 disposition](1073-nov21-open-ledger-c.md) leave them unreviewed.

## Upstream evidence

[OmniRoute #20224](https://github.com/cheaper-inference/OmniRoute/pull/20224), head `73f02b9d74324a6e2c7ebc03388e592d58233536`, base `release/v3.8.55`, merged 2026-11-23 as `713bf17cc7fd87fb2b0eff4b93d0e882963ab409` (via #20963). The relevant hunk is `open-sse/translator/request/openai-responses/helpers.ts`: `clampCallId` returned `id.slice(0, 64)` for an id over 64 characters; it now keeps 55 characters, `_`, and the first 8 hex of the SHA-256 of the whole id. Its test is `tests/unit/responses-call-id-clamp.test.ts`.

## Collision check in DurinDoor

Checked at integration head `64b2472d39c758fe6171eaba65258174224096dd` and again at `main` `4e116902a90b1ae8971db548ac9d328c04528195`; the clamp is identical in both. `clampResponsesCallId` in `open-sse/translator/formats/responsesApi.js` returned `id.substring(0, 64)`. Two ids that share their first 64 characters (for example MCP-style `functions.<server>__<tool>:0` and `:1` ids) therefore map to one `call_id`.

Reproduced before the fix: the new regression test failed 2 of 3 cases. Direct clamp of two such ids returned equal values; a Chat → Responses translation of one assistant turn with two parallel tool calls and two tool results produced a single distinct `call_id` across both `function_call` items and both outputs.

Call sites that share the clamp, all now covered by the one change: `open-sse/translator/request/openai-responses.js` (`function_call`, `custom_tool_call`, tool-result output) and `sanitizeResponsesItems` in `open-sse/executors/opencode-go.js` (native Responses passthrough). The clamp is a pure function of the id, so call and output stay paired in both places. Responses-to-Chat conversion does not clamp; it forwards `call_id` unchanged, so a client that echoes a clamped id back stays consistent. Ids at or under 64 characters are unchanged; empty or missing ids still get the sequence-based fallback.

## Open PR overlap

Checked open DurinDoor PRs (`gh pr list -R bloodf/durindoor --state open`, searches for `20224`, `call id`, `call_id`, `clamp`, plus the full list): none touches `responsesApi.js`, `openai-responses.js` or `opencode-go.js`. Open at check time: #2486, #2484, #2483, #2481, #2430, #2112, #1809, #1784. No prior DurinDoor PR or branch references #20224.

## Change

- `open-sse/translator/formats/responsesApi.js`: over-long ids become `<first 55 chars>_<8 hex sha256>`; length is exactly 64. The constant `MAX_RESPONSES_CALL_ID_LEN` and a new `CALL_ID_HASH_LEN` define the layout.
- `tests/unit/responses-call-id-clamp-20224.test.js`: behavior tests using `ROLE`, `RESPONSES_ITEM`, `OPENAI_BLOCK` and `FORMATS` constants and `translator/registerAll.js`: unchanged short ids, distinct and stable clamping for shared-prefix ids, and an end-to-end Chat → Responses parallel-call pairing.

## Verification

Run from `tests/` with `pnpm install --frozen-lockfile` at both the repo root (`--ignore-scripts`) and `tests/`.

- New test file, RED before the fix: 2 failed, 1 passed.
- New test file after the fix: 3 passed.
- Every `tests/unit` file matching `responses|tool-call|opencode`: 129 files, 959 tests, all passed (77 s).
- `tests/__baseline__/known-fails.txt` untouched.

The full four-batch `test:ci` was not run in this lane; CI on the PR is the full-suite evidence.

## Status

DurinDoor PR: [#2487](https://github.com/bloodf/durindoor/pull/2487) (draft). Not a completed port until that PR merges.
