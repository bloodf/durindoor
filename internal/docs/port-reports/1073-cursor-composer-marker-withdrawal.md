# #1073 Cursor Composer marker withdrawal

**Status: withdrawn (superseded by complete boundary-preserving port).** The unpublished candidate `be88c41bb06a05a503b762a3cef3d978f6bb1d91` documented below was withdrawn from the product tree, restoring the Cursor route byte-for-byte to its pre-candidate state. The subsequent boundary-preserving replacement and its offline verification are recorded in [the complete #4842 report](1073-cursor-composer-markers-complete-4842.md).

## The withdrawn candidate

| Field | Value |
|---|---|
| Candidate | `be88c41bb06a05a503b762a3cef3d978f6bb1d91` |
| Subject | `port(omniroute): keep Composer final markers out of visible output` |
| First parent | `641f48a059993c022bd7b9fdb372c6b731de7805` |
| Publication state | unpublished; never released, never merged to a release branch |
| Assigned branch | `orq/tornf6/withdraw-unready-cursor-composer-marker-candidate-a1` |
| Branch head before this withdrawal | `a16230c5d661490fe981989f6b3234046169a45d` |

The candidate changed three files: [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js), [`tests/unit/cursor-composer-thinking.test.js`](../../../tests/unit/cursor-composer-thinking.test.js) and [`tests/unit/cursor-agent-exec-request.test.js`](../../../tests/unit/cursor-agent-exec-request.test.js). It added a four-entry literal marker table to `visibleComposerContentFromThinking`, stripped every occurrence of those literals from the visible Composer suffix, held back a bounded marker-prefix suffix while streaming, flushed a terminal incomplete prefix as ordinary text, and relaxed the AgentService thinking fallback so it can still fire after visible text was emitted.

## Withdrawal reason

The candidate deletes a quoted marker that appears inside valid answer text. A marker literal in the answer body is answer content, not framing, and the candidate removed it unconditionally from the visible suffix. The candidate also changed the terminal-flush and fallback behavior of the shipped Cursor route, which is broader than the framing question it set out to answer. The proposal is withdrawn rather than shipped in that form.

## Head-state verification before restoring

The assigned branch head was checked against the candidate before any restore. `git diff be88c41bb06 HEAD -- open-sse/executors/cursor.js tests/unit/cursor-composer-thinking.test.js tests/unit/cursor-agent-exec-request.test.js` returned empty, so the assigned HEAD versions of all three files were exactly the candidate's versions.

Because that comparison was empty, no later unrelated edit was present on the branch for these paths, and no edit needed to be preserved separately. The restore was therefore taken directly from the candidate's first parent, which reverts only the candidate's own changes.

## Restored file identities

Blob identifiers of the restored files match the candidate's first parent exactly and differ from the candidate's own blobs:

| Path | Blob at first parent `641f48a0` | Blob at candidate `be88c41b` | Blob after restore |
|---|---|---|---|
| `open-sse/executors/cursor.js` | `f7fbbef90430ac75ddef681b3afd53ea79d81796` | `8b6ab76601d7291f4dd75f70349d96768b32f0e8` | `f7fbbef90430ac75ddef681b3afd53ea79d81796` |
| `tests/unit/cursor-composer-thinking.test.js` | `7033231df6aab63682946725186d901ae912456d` | `b747f9d1f7702de67fdc0f01f7f459fc92196257` | `7033231df6aab63682946725186d901ae912456d` |
| `tests/unit/cursor-agent-exec-request.test.js` | `11c0ebf869519b57a5cc3488544c6da90f0bc175` | `fafcadc174f0748da4dc1ef1c5eee39e2ece2eb8` | `11c0ebf869519b57a5cc3488544c6da90f0bc175` |

## Product equivalence

The restored executor is exactly the pre-candidate implementation. `visibleComposerContentFromThinking` again takes the visible suffix after the last `</think>`, trims only leading whitespace, and returns that suffix unchanged. No marker literal is removed, no suffix is held back during streaming, no terminal flush is added, and the AgentService thinking fallback again returns early once visible text has been emitted.

A quoted marker inside an answer therefore survives intact on the shipped route, and the shipped route's framing, streaming and fallback behavior is identical to the state before the candidate. All pre-existing Cursor behavior is preserved byte-for-byte; the withdrawal removes only the candidate's proposal.

The candidate's own added tests were removed with it, because both test files were restored to their first-parent state. Those were the `preserves visible text across marker fragments` cases in `tests/unit/cursor-composer-thinking.test.js`, and the `handles Composer framing fragments in AgentService` and `leaves native text deltas untouched for Composer` cases in `tests/unit/cursor-agent-exec-request.test.js`. No pre-existing test case was edited, removed, skipped or weakened, and no entry was added to `tests/__baseline__/known-fails.txt`.

## Report disposition

- [The #4842 report](1073-cursor-composer-final-markers-4842.md) is retained as the candidate record and is explicitly labeled pending product and gate work.
- [The source audit](1073-late-june-existing-cursor-visible-output.md) keeps its corrected #4554 rationale: the installed Cursor executor already extracts the visible suffix after `</think>` while keeping the preceding reasoning private, so no separate #4554 port is needed. That section is unaffected by this withdrawal. Its #4842 disposition is relabeled from adapted to pending product and gate work, and its offline-acceptance section records that #4842 has no acceptance of its own while the already-covered #4554 behavior is still accepted by the two direct Cursor unit files.

## Scope

Only the three named product and test files and the relevant #1073 Cursor reports were touched. No other provider fix was modified. No gate setting, workflow, `AGENTS.md` file or baseline file was changed. No credential was accessed, no live provider traffic was generated, and no paid API, browser, Docker or end-to-end run was performed.

## Verification

Run from the repository root, after the withdrawal commit:

```bash
git diff --exit-code be88c41bb06^ HEAD -- open-sse/executors/cursor.js tests/unit/cursor-composer-thinking.test.js tests/unit/cursor-agent-exec-request.test.js
test -s internal/docs/port-reports/1073-cursor-composer-marker-withdrawal.md
(cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/cursor-composer-thinking.test.js unit/cursor-agent-exec-request.test.js)
```

The first command exits `0`, showing the three files at `HEAD` equal the candidate's first parent. The second confirms this report is present and non-empty. The third runs the two direct Cursor unit files against the restored executor; both pass. All three results are recorded in the withdrawal commit body.

## Follow-up status

The boundary-vs-quoted marker distinction and independent offline fixtures required after this withdrawal have been completed in [the complete #4842 report](1073-cursor-composer-markers-complete-4842.md). No claim in this report establishes live provider behavior.
