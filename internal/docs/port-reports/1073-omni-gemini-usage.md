# OmniRoute #20224: Gemini usage metadata with Responses names

Upstream: `2d0d3112ad0f050e85bbba8c7f61ec4a3e67dec9` and the usage part of `73f02b9d74324a6e2c7ebc03388e592d58233536`. The Cursor part of `73f02b9d` stays not applicable, as recorded in [the row 91 comparison](1073-nov24-row-91-complete.md). That report is unchanged.

Port PR: [DurinDoor #2499](https://github.com/bloodf/durindoor/pull/2499) (draft, not merged).

## Verified gap

Probed on integration HEAD `3b6e9098db` with `{input_tokens: 10, output_tokens: 30, total_tokens: 40, output_tokens_details.reasoning_tokens: 20}`:

| Path | Before |
|---|---|
| Stream translator (Gemini family) | prompt 0, candidates 0, no thoughts |
| Non-stream projector and native Gemini JSON | prompt 10, candidates 30, no thoughts or cached count |
| `/v1beta` bridge, JSON and stream | prompt 0, candidates 0, no thoughts |

Two double counts used Chat names: the non-stream projector for non-native Gemini-family formats reported no thoughts, and the `/v1beta` bridge reported candidates 30 plus thoughts 20 for 30 output tokens. The bridge is a DurinDoor surface the row 91 comparison did not cover.

## Overlap

Open PRs checked on 2026-11-24. #2493 changes `openai-to-antigravity.js` and `gemini-to-claude.js`; this port edits neither. No other open PR touches the changed source files. `ListAgents` showed no session working on this gateway.

## Changes and adaptations

- All projections now use `buildGeminiUsageMetadata`. The non-stream handler keeps only its reported-zero detail assignments.
- Reasoning is not subtracted when `reasoningIsSubsetOfOutput` shows the upstream total counts it on top of the output. Upstream always subtracts.
- A Responses report without `total_tokens` gets input + output.
- Chat-format behavior is unchanged on the stream translator for subset reporting. Additive reporting now keeps the full output count as candidates. The non-stream projector and the bridge now report thoughts once and the cached count.
- Behavior note: [v5-protocol-conformance.md](../v5-protocol-conformance.md). Tests: `tests/translator/omni-gemini-usage-names.test.js`.

## Not covered

- Chat-format non-stream replies are filtered to Chat usage names in `filterUsageForFormat` before the `/v1beta` bridge sees them, so Responses names do not reach the bridge JSON path through the gateway. Unchanged here.
- The `/v1beta` bridge drops a trailing usage-only chunk (`choices: []`). Unchanged here.

## Evidence

- New test file: 20 tests pass; on the integration branch, 14 failed with the four source files reverted.
- That file plus every unit and translator test file naming the changed surfaces, on the PR branch (base `484c4e941a`): 678 passed, 6 skipped.
- `pnpm lint` passed. `check:agent-index` passed. `check:docs` fails on `docs/operations/stream-status-colors.mdx`, which this change does not touch.
- `openaiToGeminiResponseSelfCheck.mjs` fails with `Cannot find package '@/lib'` both with and without this change. `completionProjectorSelfCheck.mjs` passes 20/20.
- Full local CI not run. No credentials, provider calls, production gateway or machine settings.
