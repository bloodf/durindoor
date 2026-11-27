# Responses agent message inputs — OmniRoute #21417

Implemented the verified gap in `2026-11-27-full-parity-refresh.md` on 2026-11-27.

## Source and duplicate-work check

- Requested patch: https://github.com/cheaper-inference/OmniRoute/pull/21417
- Exact source commit: `6e31eb343273b8a2913424089d0c1469c42d937e`
- Source file: `open-sse/utils/responsesInputNormalization.ts`.
- Refreshed OmniRoute main: `332e93b95be914b8258ff96f3514ee60b7788c4e`.
- Refreshed DurinDoor origin/main: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`.
- Candidate starting HEAD: `83d0694c238042c61cff5671d1a57c1fbbc5c10a`.
- Read all 16 open local PRs through the PR list tool before edits; none covers this lane. The two local normalization/dispatch files have no diff against refreshed origin/main.
- Important source divergence: the requested commit is not an ancestor of refreshed OmniRoute main. That main still normalizes agent text as assistant history without provenance. This port follows the explicitly requested commit, rather than claiming the fix is merged upstream.
- CodeGraph query was attempted but the worktree has no initialized index. Bounded searches located the shared normalizer and existing Responses-to-OpenAI dispatch call.

## Behavior and ownership

`normalizeResponsesInput` recognizes `type: agent_message` or `role: agent_message`. Plaintext task/reply content becomes a user message, with an optional `[Agent message from AUTHOR to RECIPIENT]` header. Missing/non-string endpoints use `unknown` only when the other endpoint supplies a header. Text precedence, newline joining, and whitespace preservation match the source helper.

Blank, malformed, mixed unsupported, and encrypted content becomes empty reasoning metadata, which the existing dispatch ignores. No partial plaintext or opaque content is leaked. Ordinary assistant history and non-agent metadata retain their original objects; input items are not mutated. Native Responses-to-Responses translation keeps native agent items unchanged.

The schema supplies the agent discriminator. Existing dispatch already invokes the shared normalizer, so `request/openai-responses.js` and translator registration need no edits. Tests import `../translator/registerAll.js` before invoking translation.

## Evidence

Dependency installation completed for root, CLI and tests with frozen lockfiles and prefer-offline; no dependency manifests changed.

- Required command from `tests/`: `timeout 300 node node_modules/vitest/vitest.mjs run unit/parity-agent-message-input.test.js --maxWorkers=2` — 19 passed.
- Regression proof: temporarily restored the former array pass-through, ran the same file, and restored the implementation in a `finally` block — 17 failed, 2 passed, exit 1.
- Scoped evidence from `tests/`: `timeout 300 node node_modules/vitest/vitest.mjs run unit/parity-agent-message-input.test.js unit/port-14673-responses-empty-input-continuity.test.js unit/omni-nov21-responses-request-copy.test.js --maxWorkers=2` — 3 files, 37 tests passed.
- `timeout 300 pnpm exec eslint open-sse/translator/formats/responsesApi.js open-sse/translator/schema/blocks.js tests/unit/parity-agent-message-input.test.js` — exit 0.
- `git diff --check` — exit 0.
- Post-commit `timeout 300 pnpm exec commitlint --from HEAD^ --to HEAD` could not run: `Command "commitlint" not found` despite frozen dependency installation. The subject uses the required `port(omniroute):` convention.

Coverage includes agent replies/tasks, both discriminator forms, partial/non-string author and recipient metadata, content precedence, all supported text block kinds, empty text, unsupported/encrypted content, ordinary history, OpenAI and Claude dispatch, input immutability, and native Responses pass-through.

## Remaining gates and scope

No failure baseline changes. No GitHub writes, other agents, whole-suite runs, builds, service changes, or generated-file edits. Full local CI and independent model-family review remain required before merge; these are outside this scoped work order. This report establishes parity for the requested agent-message patch, not repository-wide upstream parity.
