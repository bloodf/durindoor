# Responses agent message inputs: OmniRoute #21417

## Source and scope

- Requested source: https://github.com/cheaper-inference/OmniRoute/pull/21417
- Exact source commit: `6e31eb343273b8a2913424089d0c1469c42d937e`.
- Source file: `open-sse/utils/responsesInputNormalization.ts`, inspected from the local Git object.
- Recorded refreshed OmniRoute main: `332e93b95be914b8258ff96f3514ee60b7788c4e`.
- DurinDoor origin/main at this correction: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`.
- Correction starting HEAD: `4c1abb24182c9151da598914aec412a27df341aa`.

The requested source commit is not an ancestor of the recorded refreshed OmniRoute main. This report follows that requested source, without claiming it is merged upstream.

## Accepted review finding and correction

Independent Gemini review 3 identified a HIGH finding: agent rewriting was placed in the shared `normalizeResponsesInput`, which native executors also call. The original translator identity assertion proved only that matching formats skip translation. It did not prove executor passthrough. That assertion is now named accordingly, and separate tests call the real executors.

The source confines agent rewriting to `normalizeResponsesInputForChat`; native `normalizeCodexResponsesInput` keeps its native contract. DurinDoor now follows that boundary. Shared `normalizeResponsesInput` still handles string and empty-array placeholders and preserves nonempty native arrays. `normalizeResponsesInputForChat` applies agent lowering only in the Responses-to-Chat translator and the worker Chat converter `convertResponsesApiFormat`.

Plaintext tasks and replies become user context with optional `[Agent message from AUTHOR to RECIPIENT]` provenance. Missing endpoints use `unknown` when the other endpoint supplies a header. Text precedence, joining, whitespace preservation, and unsupported-content handling remain unchanged. Unsupported, empty, or encrypted Chat input becomes an ignored reasoning marker with no partial text leakage. OpenAI and Claude translation assertions remain intact.

Native agent items retain their discriminator, provenance and payload. Codex's existing role-based message normalization still adds `type: message` and wraps string content as `input_text`; the regression explicitly expects that native representation. It never accepts conversion to a user message or reasoning marker. Native provider-specific history policies remain in force.

## Ownership trace and scoped evidence

CodeGraph ownership query `sh scripts/codegraph.sh query normalizeResponsesInput --limit 5 --json` failed because this worktree has no initialized index. Bounded `rg` under `open-sse/` found all five consumers before editing: Codex, OpenCode Go, Grok CLI, the Responses-to-Chat translator, and the worker Chat converter. Only the two Chat consumers use the new helper. No executor was changed.

Installed root, CLI and tests dependencies with frozen lockfiles and `--prefer-offline` before testing.

Before the fix, direct `transformRequest` regressions produced 8 failures and 4 passes across the three executors. Plaintext became user context and encrypted content became reasoning metadata. Coverage includes type-only, role-only, message-plus-agent-role, and agent-type-plus-assistant-role discriminators, alongside ordinary user and assistant history.

After the fix:

- `cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/parity-agent-message-input.test.js unit/parity-agent-native-executors.test.js --maxWorkers=2`: 2 files, 33 tests passed.
- `timeout 300 pnpm exec eslint open-sse/translator/formats/responsesApi.js open-sse/translator/request/openai-responses.js tests/unit/parity-agent-message-input.test.js tests/unit/parity-agent-native-executors.test.js`: exit 0.
- `git diff --check`: exit 0.
- `timeout 300 pnpm exec commitlint --from HEAD^ --to HEAD`: unavailable, `Command "commitlint" not found` despite dependency installation. The commit subject follows the required Conventional Commits format.

## Remaining gates

No baseline changes, GitHub writes, other agents, full-suite runs, builds, service changes, generated-file edits, or executor edits. Full local CI and independent model-family review remain merge gates outside this scoped correction. The evidence establishes the requested translation boundary and actual executor behavior, not repository-wide upstream parity.
