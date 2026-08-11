# Upstream PR Port — #3223 (2026-08-11)

Single `decolua/9router` pull request that closes one verified fork gap. Verdict
and evidence:

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| [#3223](https://github.com/decolua/9router/pull/3223) `fix(antigravity): strip competitive system prompt marker` | PORTED | `open-sse/executors/antigravity.js` `transformRequest` (post-`stripBlacklisted`, pre-`transformedRequest` build) never inspected `systemInstruction.parts`, so the literal string `You are a Claude agent, built on Anthropic's Claude Agent SDK.` — the marker Zed IDE injects to identify Claude to the Anthropic SDK — flowed through to Antigravity, which flagged the request and answered `429 Quota Exhausted`. | Walk every `systemInstruction.parts[i].text`, split/join the exact marker out, and mutate the part in place. Tests in `tests/translator/port-3223-antigravity-system-prompt.test.js`. |

## Why the match stays narrow

The marker is the only string the upstream PR targets, and the gap is scoped to
that exact prompt. The patch is intentionally a literal-string rewrite rather
than a broader content filter:

- A heuristic (`role: "system"` truncation, "ignore previous instructions",
  PII patterns, etc.) would risk removing legitimate instructions the
  gateway-operator's client already vetted, which is the failure mode that
  forks the trust boundary between the client IDE and the upstream provider.
- Antigravity's own detection is a literal substring match, not a semantic
  check. Mutating anything broader than the marker decouples our rewrite
  from the upstream detector; the next time 9router's detector changes,
  the fork would have to chase it again with a different rewrite.
- A precise split/join leaves everything else byte-identical and makes the
  change easy to delete when the upstream provider stops rejecting the
  marker (or when the upstream PR is itself reverted). The ledger entry
  and the test fixture lock the marker string so a future rewriter cannot
  silently widen the pattern.

## Adaptations

- **No structural changes.** Upstream mutates `requestWithoutTools.systemInstruction.parts`
  in place before the `transformedRequest` object is built. The fork follows
  the same seam so the rewritten `parts` array ends up on the wire untouched
  by anything downstream (no copy, no re-derivation).
- **Comment anchors the upstream PR.** The inline comment names
  `decolua/9router#3223` and points to this ledger so the next reader knows
  why the marker string is a magic constant rather than a config value.

## Verification

- `tests/node_modules/.bin/vitest run --root . --config tests/vitest.config.js tests/translator/port-3223-antigravity-system-prompt.test.js`:
  `3 passed (3)` after the fix; the marker-removal case fails as RED
  (`expected 'Keep this. You are a Claude agent, bu…' to be 'Keep this.  Continue.'`)
  before the fix.
- Revert proof: removing the in-place rewrite restores the RED failure above
  for the marker-removal case only; the unrelated-system and no-system cases
  stay green throughout.
