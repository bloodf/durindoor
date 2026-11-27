# Verification: OmniRoute #21388 reasoning holdback

**Verdict: confirmed as an absent optional upstream feature; no current behavior defect established. Severity: low / parity-only.** OmniRoute PR #21388 adds opt-in suppression and fallback for reasoning-only output in sequential combo streaming. DurinDoor's current combo contract treats reasoning as output, so the reviewed example does not satisfy the existing empty-stream fallback condition. This verification does not establish whether any live provider accepts or emits the proposed behavior.

## Exact trees

Compared current main `29490b783e83176d4d6a4162f76ee3dc79db66ea` and the requested frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c` (not an integration branch). Both objects resolve in this checkout. For the relevant current implementation paths:

```text
git diff --no-ext-diff --stat 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c -- open-sse/services/combo.js open-sse/utils/streamContentPeek.js
<no output; files are identical>
```

## Source trace

Commands used:

```text
git show 29490b783e83176d4d6a4162f76ee3dc79db66ea:open-sse/utils/streamContentPeek.js | nl -ba | sed -n '40,90p'
git show 29490b783e83176d4d6a4162f76ee3dc79db66ea:open-sse/services/combo.js | nl -ba | sed -n '1829,1909p'
git show 29490b783e83176d4d6a4162f76ee3dc79db66ea:open-sse/utils/streamContentPeek.js | nl -ba | sed -n '225,280p'
```

`frameCarriesContent` returns true for nonempty `choices[0].delta.reasoning_content` and `.reasoning` (peek file lines 53–60). `peekStreamForContent` uses that predicate while reading SSE, keeps consumed bytes in the replay stream, and reports content on a content verdict (lines 229–243, 251–257). In combo, a successful SSE response is peeked with `releaseOnProgress: true` (combo lines 1829–1832). If the peek finds no content, combo cancels the body, records failure, and continues to the next member (1851–1871). If it finds content, combo wraps the replay body, records the member successful, and returns that result (1873–1879, 1900–1908).

Therefore an SSE content delta containing only `reasoning_content: "draft"` is content under the present classifier. If the stream subsequently stalls, ends, or times out, the prefix peek has already returned a content verdict; ordinary no-content fallback does not run. A minimal payload matching the trace is:

```text
data: {"choices":[{"delta":{"reasoning_content":"draft"}}]}
```

This is a precise source trace against both the classifier and its combo caller/downstream return path; no dependency install or candidate execution was needed. The behavior is not shown to violate the current contract. Withholding the reasoning and retrying only when configured is the new upstream feature itself, rather than a fix to empty-stream handling.

## Disposition and ownership

- **Confirmed:** the compared trees have no holdback implementation, and reasoning-only SSE output is currently accepted as content by combo.
- **Dropped:** characterizing this as a failure of existing empty-stream fallback. That path only applies when the peek finds no meaningful frame.
- **Uncertain / not claimed:** live provider behavior, whether a provider will accept any redacted checkpoint, and the operational value of enabling the new opt-in policy.
- **Severity:** low; optional feature parity, with the potential operational tradeoff confined to configurations that choose to adopt it.
- **Issues and lanes:** GitHub issue searches for open reports matching “reasoning holdback” and “reasoning-only” found no dedicated open item. The `reasoning-only` query found #2648, which concerns declared `none` reasoning tiers and is unrelated. The report commit's cited auth-owned #2266/#2289 and sync ownership of usage/shared-refresh files are outside these combo/peek paths. No issue or ownership change is proposed.

## Evidence commands

```text
git show --stat --oneline --decorate --no-renames c65590451e
  c65590451e docs: review OmniRoute reasoning holdback parity
  1 file changed, 9 insertions(+)

git show --no-ext-diff --unified=80 --no-renames c65590451e --
  Read internal/docs/port-reports/review-omni-21388-reasoning-only-streams.md;
  it describes PR #21388 as an opt-in combo holdback/failover feature.

git rev-parse 29490b783e83176d4d6a4162f76ee3dc79db66ea 32a783d76d45d90bf0517015442f43fadd96106c
  29490b783e83176d4d6a4162f76ee3dc79db66ea
  32a783d76d45d90bf0517015442f43fadd96106c

GitHub issue search (open): repo:bloodf/durindoor "reasoning holdback"
  issues: []
GitHub issue search (open): repo:bloodf/durindoor "reasoning-only"
  issue #2648: [Low] Handle models that declare only disabled reasoning (unrelated)
```

No tests, candidate execution, services, gateway, secrets, live providers, product edits, issue mutations, or PR operations were used.
