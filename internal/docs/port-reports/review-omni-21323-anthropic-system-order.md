# OmniRoute #21323 — Anthropic system turn order

**Verdict: concrete missing behavior; medium severity.** The current first-party Anthropic API-key path folds mid-conversation system text into a later user message. It does not preserve the supported `role: "system"` turn at its original position for the model and message shapes in this PR. That changes both the role and where the instruction enters the conversation.

## Upstream candidate

Read-only GitHub API metadata on 2026-11-27 reports OmniRoute PR [#21323](https://github.com/cheaper-inference/OmniRoute/pull/21323) still **open**, with base `16e2c146fb5b8e4ee6364fb679ffe412880757fb` and head `e3e57987099cd02840dcb6020f840f595522466c`.

Changed paths:

- `changelog.d/fixes/anthropic-api-system-turn-order.md`
- `open-sse/handlers/chatCore.ts`
- `open-sse/handlers/chatCore/claudePassthroughBody.ts`
- `open-sse/handlers/chatCore/claudeSystemRole.ts`
- `tests/unit/claude-tool-free-system-context.test.ts`

The new test covers an official API route (`provider: "anthropic"`, Claude format), a supported model (`claude-sonnet-5-5`), plain text system messages, and no tools. It asserts the leading system text is hoisted while the later system turn remains after the first user turn. Other tests cover model/provider/format exclusions, developer turns, unsupported placement, and configured global prompts.

## Local comparison

Compared Git objects for `origin/main` `29490b783e83176d4d6a4162f76ee3dc79db66ea` and frozen `train/2` `32a783d76d45d90bf0517015442f43fadd96106c`. Both have identical blobs for `open-sse/translator/formats/claude.js` (`8597d47a6632d75d83ca19b6f708879302fd972f`) and `tests/unit/claude-cache-control.test.js` (`da3e26592d42e6c9a204ac30ea508660bf70bcab`); the behavior is the same in both refs.

On the local native passthrough path, `open-sse/handlers/chatCore.js:831` calls `normalizeClaudePassthrough(..., { foldSystemTurns: true })` for Claude clients. `open-sse/translator/formats/claude.js:811-835` buffers instruction-role content and appends it to the next user message; in the `foldSystemTurns` branch it does not preserve the system role. The focused existing test, `tests/unit/claude-cache-control.test.js:232-258`, explicitly expects the reminder to follow the next user message's existing content. For the PR's shape:

```text
user("first"), system("later instruction"), user("second")
    -> user("first"), user(["second", "later instruction"])
```

The upstream test expects `user("first"), system("later instruction")` (with leading system instructions moved into top-level `system`). The local fold is not parity: the text becomes user content and is positioned after the next user turn's content. This can change instruction precedence/meaning on official API traffic.

## Ownership and limits

The full parity refresh had #21323 as unrecorded at this head. The existing #16236 row in `1073-october-16-23-row-dispositions.md` is unresolved and records earlier broad compatible-relay behavior; it is not an active local issue or an implementation claim for this official API-key case. A title search of open DurinDoor issues found no open issue for Anthropic system-turn ordering. None of the sync-lane issue numbers listed in the review request owns this candidate. No duplicate owner was identified.

This is a source-level parity verdict against the upstream PR's stated model/shape scope. No dependencies or product code were executed, and this report does not independently verify Anthropic's current service acceptance contract.
