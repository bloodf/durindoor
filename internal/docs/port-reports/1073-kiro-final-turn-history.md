# #1073 — Kiro request history keeps the original turn order

- Inventory: https://github.com/bloodf/durindoor/issues/1073
- Source: https://github.com/cheaper-inference/OmniRoute/pull/2104 (`fix(kiro): normalize tool-use payloads`), merged at https://github.com/cheaper-inference/OmniRoute/commit/4a6865650d127be0b1105ca01d46092c3b52cf59 (first parent `4f202f3fa5d0db738306917e0ccb65a9212b791b`), head `2aef379e40b278d1d2788a27a8d80c1b350ed121` (parent `08e18867fde31708410c39b7f648c550cce05850`), commit date 2026-05-09 21:39:10 -0300, merged 2026-05-10T00:39:11Z.
- Complete changed paths in the merged patch: `open-sse/translator/request/openai-to-kiro.ts`, `tests/unit/translator-openai-to-kiro.test.ts`.
- Compared against: the current integration tip `23ac12d68ade4c2a4225f141f01e7278084f4fc3` (`orq/tornf6/integration`) and the May protocol comparison `internal/docs/port-reports/1073-may-protocol-shapes.md`, which recorded the third part of this upstream change as gap **K-1**.
- Local base: `23ac12d68ade4c2a4225f141f01e7278084f4fc3`.

## Disposition: ported (gap K-1 closed)

The upstream change has three parts. Two were already present locally and are unchanged by this port; the third was the gap.

- (a) tool input schema normalization — already present: `normalizeKiroToolSchema` in `open-sse/config/kiroConstants.js`, applied to every tool at `open-sse/translator/request/openai-to-kiro.js:282`. The local normalizer is stricter than upstream's.
- (b) lowercase tool-result `status` — already present: `open-sse/translator/request/openai-to-kiro.js:372` and `:384` emit `"success"`, with `"error"` reserved for failed results.
- (c) `currentMessage` selection when the transcript does not end with a user turn — **ported now**.

## The defect that was verified

Upstream replaced its "promote the last `userInputMessage`" rule with an explicit one:

```ts
if (history.length > 0 && history[history.length - 1].userInputMessage) {
  currentMessage = history.pop();
} else {
  currentMessage = { userInputMessage: { content: "Continue", modelId: model } };
}
```

The local translator selected the current turn the same way upstream did **before** the fix: `open-sse/translator/request/openai-to-kiro.js:437-443` (pre-port) scanned `history` backwards and spliced out the **last** `userInputMessage` wherever it sat, trailing assistant turns included.

That is the inversion the May comparison flagged as K-1. It was reproduced offline before the port, with the new fixture, on the unmodified translator:

- transcript `[user "First user", assistant "Assistant answer"]` produced `history = [assistantResponseMessage]` and `currentMessage` = the `"First user"` turn — the assistant answer was replayed **before** the user turn it answered, and the user content was restated to the model;
- transcript `[user "Read the file", assistant tool_call]` produced `history = [assistantResponseMessage(toolUses)]` and `currentMessage` = the `"Read the file"` turn — same inversion, with the tool call ahead of its own prompt;
- a four-turn transcript `[user, assistant, user, assistant]` produced three history entries instead of four: the second user turn was lifted out of history.

Kiro reads `conversationState.history` and then `conversationState.currentMessage`, so the wire order is history-then-current. Promoting an older user turn therefore emitted the client's transcript backwards.

## The port

`open-sse/translator/request/openai-to-kiro.js`:

- `:450-466` replaces the backwards scan with the upstream rule. When the transcript's last turn is a user turn, that turn becomes `currentMessage` and leaves `history`. When the transcript ends with an assistant or tool turn, every original turn stays in `history`, in the client's order and exactly once, and `currentMessage` is a neutral continuation.
- `:185-196` adds `KIRO_CONTINUATION_CONTENT = "Continue"`, the neutral continuation for that synthesized current turn.
- `:516-519` drops the now-unreachable `if (!currentMessage)` fallback that used to build an empty current turn for a transcript with no user turn at all; the synthesized continuation covers that case instead.

### Why "Continue" and not a restated user turn

The synthesized turn must not restate a user turn that is already in `history`. The local tree already has a neutral continuation for exactly this shape — a transcript that ends with an assistant turn — in the Gemini request translator, which appends a user turn carrying `[{ text: "Continue" }]` when the last content is a model turn (`open-sse/translator/request/openai-to-gemini.js:66-79`). The port reuses that convention and the upstream string, so the Kiro current turn reads `[Context: Current time is <ts>]\n\nContinue`.

Two other continuation mechanisms exist locally and were deliberately **not** used:

- The Kiro translator's own bare-turn placeholder (`open-sse/translator/request/openai-to-kiro.js:239`) fills an *empty user turn the client actually sent* with the word `continue`, and the existing regression fixture `tests/unit/openai-to-kiro.test.js:307` pins that this word must not be injected when the turn carries tool results, because it leaks into the visible conversation as if the user had typed it. That placeholder is a different case and is left untouched.
- The Claude-format layer (`ensureTrailingUserTurn` at `open-sse/translator/formats/claude.js:838`, `applyAssistantPrefillPolicy` at `open-sse/translator/concerns/assistantPrefillPolicy.js:32`) restores a trailing user turn for Claude-source requests before translation. It is bound to the Claude source format and does not run on the OpenAI-source path that reaches this rule, so it cannot serve as the Kiro current turn. It is also unchanged by this port.

### Preserved behaviour

- A real final user turn keeps the existing behaviour exactly: that turn becomes `currentMessage` and leaves `history`, carrying its tool results, images and tools context. `tests/unit/openai-to-kiro.test.js:307` (tool-result-only turn) still passes unchanged.
- Session affinity is unchanged: `conversationId` still comes from `translationContext.clientSessionId` or `resolveSessionId` (`open-sse/translator/request/openai-to-kiro.js:638`).
- Existing limits are unchanged: the output-ceiling rejection (`validateKiroOutputLimit`, `:552`) still rejects an explicit `max_tokens`/`max_completion_tokens` with HTTP 400 before any of this runs.
- The tools schema still reaches the current turn from the first user turn that received it (`firstHistoryTools` at `:469`, injected at `:538-546`), and orphaned tool-result reconciliation still runs over history and current turn (`:532`).
- Consecutive user turns are still merged inside `history` (`:485`), which is upstream #2105's rule and is unaffected.
- The Kiro outbound envelope validator, the agentic first-turn prompt, the thinking prefix and the timestamp prefix are untouched.

### Recorded local differences (not gaps)

- The local translator is JavaScript and carries stages upstream does not have (tool-schema normalization, tool-result orphan reconciliation, consecutive-user merging, the no-fabrication flatten policy). The port is placed at the same decision point as upstream's, before the tools capture and the cleanup pass, so those stages still see the same inputs.
- Upstream synthesizes its continuation with `modelId: model`; the local synthesized turn does the same, and the payload builder overwrites the current turn's `modelId` with the resolved wire id anyway (`:647`).
- Upstream's `normalizeKiroToolSchema` is weaker than the local one, and upstream emits `"Continue"` while the local bare-turn placeholder says `continue`. Both are recorded, neither is a protocol difference.

### Not in scope

Gap **K-2** from the May comparison — the tools schema is still read from `history[0]` only, so a transcript that opens with an assistant turn, or has no user turn at all, still reaches Kiro without `currentMessage.userInputMessage.userInputMessageContext.tools` — comes from upstream #2149 and is unchanged by this port. The current-turn selection no longer *causes* that shape: with a trailing assistant turn the schema is carried from the first user turn, which is the case K-2 does not cover.

## Verification

Offline only. No provider traffic, no credential, no network call, no browser, no Docker, no e2e, and no whole-suite run.

- New fixture: `tests/unit/omni-kiro-final-turn-history.test.js` (8 cases). It pins the assistant tail (one-turn and four-turn transcripts), the tool tail (a trailing tool call and a completed tool exchange), the real final user turn, the tool-result current turn, session affinity, and the output-ceiling rejection. Each case asserts the order of `conversationState.history`, the identity and content of `currentMessage`, and that no user turn appears twice.
- Focused run of the new file and the Kiro translator surface:

  ```
  cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-kiro-final-turn-history.test.js
  ```

  → 1 file, 8 tests, all passed.

- Regression surface: `tests/translator/` (102 files, 1879 passed, 34 skipped) and the Kiro-adjacent unit files (53 files, 524 passed) — all passed.
- Anti-slop/oxlint gate on the changed translator file: no diagnostics.

Test dependencies were installed from the local content-addressable store with a frozen lockfile (`pnpm install --frozen-lockfile --offline` at the root and in `tests/`); no dependency was added, changed or fetched from a public registry.

## Verification limits

This report verified the named upstream record only: its merged state, exact head and merge objects, and the content of the merged patch, read from the read-only mirror `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` as `git diff 4a6865650d127be0b1105ca01d46092c3b52cf59^1 4a6865650d127be0b1105ca01d46092c3b52cf59`. It verified the local behaviour by reading the local source and by running the checked-in offline fixtures named above. It does not establish live Kiro behaviour: no account was used and no request was sent, so whether Kiro accepts the synthesized `"Continue"` current turn in every trailing-assistant shape is not confirmed against the provider. The other two parts of #2104 were confirmed present by source reading and by the existing local fixtures, not by a new dedicated fixture. No claim is made about the remaining May 2026 records or about any upstream record outside #2104.

Refs #1073
