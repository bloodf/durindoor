# Verify: OmniRoute #21323 — Anthropic system turn order

Verdict summary

| Claim in candidate report (44c06e5, `review-omni-21323-anthropic-system-order.md`) | Verdict | Severity |
|---|---|---|
| Native Claude passthrough folds a mid-conversation `system` turn into the next `user` turn, after that turn's existing content | **Confirmed** (executed offline on main) | n/a (describes intended, tested behavior) |
| Shape `user("first"), system("later"), user("second")` becomes `user("first"), user(["second","later"])` | **Confirmed** (executed offline on main) | n/a |
| Upstream #21323 preserves the official-API `system` turn in place (`user, system`) | **Confirmed as upstream behavior** from the PR diff (read-only `gh pr diff`); not verified against any provider | n/a |
| The local fold is a **defect** that should be fixed | **Dropped as a defect.** The fold is a deliberate, documented, tested policy in this repo. It conflicts with the repo's stated Anthropic contract. | none assigned |
| Local behavior is a **parity gap** versus upstream #21323 for official-API traffic | **Uncertain.** Real divergence, but it rests on an unverified premise: that the Anthropic Messages API accepts `role: "system"` mid-array for `claude-sonnet-5-5`. Nothing here proves or disproves it. | Uncertain; not "medium" |
| "Local fold changes instruction meaning/precedence on official API traffic" | **Uncertain.** Requires live or official-contract evidence; not asserted. | Uncertain |

Bottom line: do not port #21323's behavior into the native passthrough fold on the strength of this review. Doing so would reverse a documented decision. The premise needs official Messages API documentation or live evidence, which this review did not gather.

## Refs and inputs

- Candidate report commit: `44c06e56dbd4f5863ac1464f24438d1bc7ed0fd1`, file `internal/docs/port-reports/review-omni-21323-anthropic-system-order.md`. The brief named a `verify-...` path for the candidate, but the candidate was written at a `review-...` path. This review is written to the requested `verify-...` path.
- Main: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (commit; tree `ba241eb7e1ff2a3840359ad583320c5645090c69`).
- Frozen train: `32a783d76d45d90bf0517015442f43fadd96106c` is a **commit**, not a tree. Its tree is `fd449b3cefa538d912c3b51dee0ed774ede580e6`. The comparisons below use that commit's tree.
- Worktree HEAD: `c8a757e8c0686aad4338071fc4d6a6283b7c2682` (branch `orq/tp3r51/verify-omni-21323-a1`). Main is an ancestor of HEAD.
- Upstream PR #21323 metadata (read-only `gh pr view`): OPEN, base `16e2c146fb5b8e4ee6364fb679ffe412880757fb`, head `e3e57987099cd02840dcb6020f840f595522466c`, changed paths matching the candidate. Title: `fix(sse): preserve supported Anthropic API system turn order`.

### Blob and file comparisons

Command: `git rev-parse` / `git ls-tree -r <ref> --name-only` for the relevant paths.

| Path | main | train tree (`fd449b3c`) | HEAD |
|---|---|---|---|
| `open-sse/translator/formats/claude.js` | `8597d47a6632d75d83ca19b6f708879302fd972f` | `8597d47a6632d75d83ca19b6f708879302fd972f` | `8597d47a6632d75d83ca19b6f708879302fd972f` |
| `tests/unit/claude-cache-control.test.js` | `da3e26592d42e6c9a204ac30ea508660bf70bcab` | `da3e26592d42e6c9a204ac30ea508660bf70bcab` | (not compared) |
| `open-sse/handlers/chatCore.js` | `806e12b340748fa8d774b4739a41aea3c0b1eaaa` | `3200c19e2a7aabb031f34fa8a65618bf0cdc7664` | (not compared) |

- The candidate's claim of identical blobs for `claude.js` and the cache-control test is **confirmed**.
- `chatCore.js` differs between main and train. `git diff main train -- open-sse/handlers/chatCore.js` shows an unrelated thinking-effort change (`catalogEffortIntent`, OmniRoute #21347, around lines 569-575). The passthrough call site is the same line in both refs, moving from `:831` to `:835`.
- The candidate's trace is not invalidated by the train difference.

### Ownership and issue checks

- `gh issue view 2266` → **OPEN**, "[low] Combo routing: 2348-line combo.js, inconsistent runtime-state convention, O(n) affinity prune per request".
- `gh issue view 2289` → **OPEN**, "[medium] Compression split across three stages and config sources; headroom stack engine always assumes OpenAI; dead compact.js".
- **Discrepancy with the brief:** the brief said auth owns #2266/#2289. Their titles are combo routing and compression, not auth. Neither touches the Anthropic fold path.
- The sync-lane issue numbers that the candidate says it checked were not supplied to this review, so that claim is **not independently verified**.
- `gh issue list --state open --search "anthropic system message OR system turn OR mid-conversation system"` returned only #1056 (roadmap). No open issue names this behavior.
- Repo records: `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1746` lists `#21323` as "Unrecorded at this head; review required." `1073-october-16-23-row-dispositions.md:373` lists `#16236` as unresolved.

## Local code path (main), traced

1. `open-sse/utils/clientDetector.js:9` — `NATIVE_PAIRS.claude = ["claude", "anthropic"]`. For a Claude client on provider `anthropic` (official API key path), `isNativePassthrough` returns true (`:66-75`).
2. `open-sse/handlers/chatCore.js:813-831` — the passthrough branch builds the body. Line 831: `if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model, provider, ..., { foldSystemTurns: true, ... });`. No model, tool, or provider gate is applied before the fold.
3. `open-sse/translator/formats/claude.js:112-116` — the code's own contract: `// OpenAI "developer" is an instruction turn. Anthropic rejects it in messages[] the same way it rejects role "system", so both share this fold/hoist policy.`
4. `open-sse/translator/formats/claude.js:811-835` — with `foldSystemTurns`, instruction-role blocks are buffered (`:819-825`). The next `user` message receives them **after** its existing content (`:827-835`). The `system` role never reaches `messages[]`. Top-level `system` is untouched.
5. `open-sse/translator/formats/claude.js:859-872` — trailing system content (no later user turn) is intentionally not folded backward. Only its cache marker moves to the last user turn. Text is dropped.
6. Other caller: `open-sse/executors/github.js:466` calls `normalizeClaudePassthrough` **without** `foldSystemTurns`, so it takes the hoisting branch (`claude.js:838-858`).

## Executed offline check (main code only)

Setup, all private:

```
W=/var/tmp/vo-21323-3871466
git archive 29490b783e83176d4d6a4162f76ee3dc79db66ea open-sse src package.json | tar -x -C "$W/main"
env -i PATH="$PATH" HOME="$W/home" DATA_DIR="$W/data" TMPDIR="$W/tmp" W="$W" timeout 120 node fold-check.mjs
```

The script imports `normalizeClaudePassthrough` from the extracted main `claude.js` and runs four cases, each with `model: "claude-sonnet-5-5"`, `max_tokens: 100`, and no tools. Output (verbatim):

```
CASE1 mid-system fold: {"system":[{"type":"text","text":"stable"}],"messages":[{"role":"user","content":"first"},{"role":"user","content":[{"type":"text","text":"second"},{"type":"text","text":"later instruction"}]}]}
CASE2 non-fold path:   {"system":[{"type":"text","text":"stable"},{"type":"text","text":"later instruction"}],"messages":[{"role":"user","content":"first"},{"role":"user","content":"second"}]}
CASE3 leading system, fold: {"messages":[{"role":"user","content":[{"type":"text","text":"first"},{"type":"text","text":"lead instruction"}]}]}
CASE4 trailing system, fold: {"messages":[{"role":"user","content":"first"},{"role":"assistant","content":[{"type":"text","text":"ok"}]},{"role":"user","content":[{"type":"text","text":"Continue from the assistant response above without repeating it."}]}]}
```

Reading the output:

- **CASE1 (confirmed):** the candidate's trace is exact. The role becomes `user`, and the text lands after the next user turn's existing content. Top-level `system` is unchanged.
- **CASE2 (new finding for the candidate's framing):** the non-fold path does not preserve position either. It hoists the mid-conversation system text into top-level `system`. Neither local path keeps a `system` turn in place. The candidate's "preserve position" is therefore not an existing local behavior on either path. The local choice is between two non-positional policies.
- **CASE3:** a leading system turn on the fold path is folded into the first user turn, not hoisted to top-level `system`. This is a narrow parity difference from upstream's leading-turn hoisting. It is inside the same deliberate policy. Severity: low; not a defect.
- **CASE4:** the trailing `system` text ("stray hint") is dropped. The synthetic "Continue from the assistant response…" user turn comes from a separate assistant-tail normalizer. This is intentional and tested (see below), so it is **not** reported as a defect.

Warnings in the output (`MODULE_TYPELESS_PACKAGE_JSON`) are cosmetic; the extracted tree has no `"type"` field.

The existing test suite was not run. Its dependencies are not installed in this worktree, and the brief allowed a source-only review. The existing tests were read directly instead.

## Existing repo evidence that the fold is deliberate

- `tests/unit/claude-cache-control.test.js:231-259` — describe block "normalizeClaudePassthrough foldSystemTurns: true (native chatCore passthrough)". Asserts that the volatile reminder "lands INSIDE the next user turn, after its existing content" and top-level `system` "must NOT pick up the volatile system message."
- `tests/unit/claude-cache-control.test.js:293-295` — the repo's test states: "The Anthropic Messages API does not allow role:\"system\" inside messages." This contradicts the candidate's premise.
- `tests/unit/claude-cache-control.test.js:406-434` — "drops a trailing system message…" and "drops trailing system blocks even when the preceding retained turn is a user." Intentional.
- `internal/docs/port-reports/1072-close-v2-port-1.md:7` records the same decision for upstream #1585. The text reads, in full: "local code folds system text into the next user turn and drops a trailing system turn, while upstream hoists everything into the top-level `system` with a new one-hour cache marker. That would reorder instructions and change cache semantics, so it was not ported."
- `internal/docs/port-reports/1072-nov22-port-1585.md:3` marks #1585 as superseded: "folds system turns into messages instead of … top-level system hoisting, to preserve cache prefixes."

So the fold policy was chosen to protect the top-level system cache prefix from volatile instruction text. It was not an oversight.

## Upstream #21323, read from the PR diff

Read-only: `gh pr diff 21323 -R cheaper-inference/OmniRoute` (saved to `/var/tmp/vo-21323-diff.patch`, not committed).

- Upstream adds an **official-only exception** in `open-sse/handlers/chatCore/claudeSystemRole.ts`, gated on: `provider === "anthropic"`, `sourceFormat === claude`, a model regex matching `claude-(fable|mythos)-5…`, `opus-4-8/5…`, or `(sonnet|haiku)-5-5`, `getSystemPromptConfig().enabled === false`, and strict placement. Each system turn must be plain text and either follow a `user` turn that is followed by an `assistant` turn or end the array.
- Upstream's own test (`tests/unit/claude-tool-free-system-context.test.ts`) asserts, for the official-only case, `roles === ["user","system"]` with leading `Leading instruction` hoisted into top-level `system`. This matches the candidate report's description.
- The same test asserts that non-official providers, unsupported models, and translated formats keep full hoisting. Upstream therefore keeps the hoisting policy for everything except this narrow official case. This narrowness is not in the candidate report's summary.
- Upstream's changes depend on modules absent from main (see next section).

## Absent optional upstream features (not existing behavior defects)

Verified absent from main with `git ls-tree -r 29490b78… | grep …`:

- `open-sse/handlers/chatCore.ts` (main is `.js`)
- `open-sse/handlers/chatCore/claudeSystemRole.ts`
- `open-sse/handlers/chatCore/claudePassthroughBody.ts`
- `open-sse/handlers/chatCore/claudeUpstreamMessages.ts`
- `open-sse/services/claudeMidConversationSystem.ts`
- `open-sse/services/claudeCodeConstraints.ts`
- `open-sse/services/systemPrompt.*`
- `changelog.d/` (no directory on main)

Upstream's `claudeSystemRole.ts` is marked `MODIFIED` against base `16e2c14`, so it is part of an upstream lineage. Related local record: `internal/docs/port-reports/1073-august-first-row-dispositions.md:690` (#9457 "claude-system-role-cache-boundary") is "UNRESOLVED."

A port would therefore need a new mid-conversation-system policy layer, not a one-line fix. The absent modules are a missing feature family, not a broken local behavior.

## Decisions for the candidate report's claims

1. **"Medium severity, concrete missing behavior."** Not supported as stated. The behavior described is real code, but it is an intentional policy. Whether it is a defect depends on whether the Anthropic Messages API accepts mid-array `role: "system"` for official models. This review cannot establish that. Downgrade to an uncertain parity item.
2. **"Upstream test expects `user, system`."** Confirmed from the diff. The candidate's summary omits the official-only gating, which is narrower than "the official API path."
3. **"No open issue for Anthropic system-turn ordering."** Confirmed by search (only #1056 appeared).
4. **"#16236 is unresolved and not an implementation claim."** Confirmed. The row is at `1073-october-16-23-row-dispositions.md:373`.
5. **"Sync-lane issue numbers do not own this."** Not verified. The numbers were not provided.
6. **"Behavior is the same in both refs."** Confirmed for the passthrough path and both tests. `chatCore.js` differs only by an unrelated change.

## What would settle the premise (not done here)

- Official Anthropic Messages API documentation stating whether `role: "system"` is accepted in `messages[]` for the named models. Anthropic's public docs were not consulted in this review.
- A live request with a mid-array system turn, which this review was not permitted to run (no live providers, secrets, or gateway).
- Until one of those exists, neither porting #21323 nor reversing the fold is supported by evidence.

## Commands run (read-only unless noted)

- `git show 44c06e56dbd4f5863ac1464f24438d1bc7ed0fd1:internal/docs/port-reports/review-omni-21323-anthropic-system-order.md`
- `git rev-parse <main>^{tree}`, `git rev-parse <train>^{tree}`, `git cat-file -t <train>`
- `git ls-tree -r <ref> --name-only | grep …`
- `git show <main>:open-sse/translator/formats/claude.js | awk 'NR>=760 && NR<=880 …'`
- `git show <main>:open-sse/handlers/chatCore.js | awk 'NR>=815 && NR<=845 …'`
- `git diff --stat <main> <train> -- open-sse/handlers/chatCore.js open-sse/translator/formats/claude.js`
- `gh issue view 2266 --json …`, `gh issue view 2289 --json …`, `gh issue list --state open --search "…"`
- `gh pr view 21323 -R cheaper-inference/OmniRoute --json …` (metadata)
- `gh pr diff 21323 -R cheaper-inference/OmniRoute > /var/tmp/vo-21323-diff.patch`
- `git archive <main> open-sse src package.json | tar -x -C /var/tmp/vo-21323-3871466/main`
- `env -i PATH=… HOME=/var/tmp/vo-21323-3871466/home DATA_DIR=… TMPDIR=… timeout 120 node fold-check.mjs` (exact output above)

Not run: `pnpm install`, the Vitest suite, commitlint (dependencies not installed; this is a source-only review).
