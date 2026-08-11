# Upstream Port Ledger — 2026-08-09 (D2 + D3)

Scope: `decolua/9router` PRs #3116, #3167 (tool-call normalization) and #3163
(timezone-aware usage chart). Anchors and the deferred list live in
[`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md).

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #3116 `fix(nvidia): normalize tool names/IDs & restore original names` | PORTED | `open-sse/translator/concerns/toolCall.js` had no tool-NAME normalization, so a name violating OpenAI's `^[a-zA-Z0-9_-]{1,64}$` (common when relaying MCP-minted names) was sent verbatim and rejected. NVIDIA additionally rejects the long opaque tool-call IDs other providers mint. | Added `normalizeOpenAIToolNames` / `restoreOpenAIToolNames` and `nvidiaToolCallId` / `normalizeNvidiaToolCallIds`. Names are normalized for every OpenAI-format target and folded into the fork's existing `toolNameMap`, so the response path de-cloaks through `decloakToolNames` rather than a parallel mechanism. ID collapsing is scoped to NVIDIA. Registry gains `quirks.toolNameMaxLength`. |
| #3167 `fix(openai): normalize overlong tool call IDs` | PORTED | The official OpenAI transport rejects tool-call IDs over 64 characters, which clients inherit when relaying IDs minted by other providers. | Normalize each distinct overlong ID once per request (sanitized 20-char prefix + base64url SHA-256 digest, landing exactly on 64) so an assistant call and its tool result keep matching identifiers. Scoped to the official `openai` provider. Kept in a separate commit and test file from #3116 — different constraint, different providers. |
| #3163 `fix(usage): make hourly usage chart timezone-aware` | PORTED | `src/lib/db/repos/usageRepo.js` bucketed every timestamp in server-local time, `src/app/api/usage/chart/route.js` ignored `tz`, and `UsageChart.js` sent no timezone, so users outside the server's zone saw shifted buckets. | Ported IANA validation with fallback, tz-aware day boundary, 24-hour label pass-through, route forwarding, and the browser timezone query. |

## Implemented changes (#3163)

- `src/lib/db/repos/usageRepo.js`
  - `getChartData(period = "7d", timeZone)` validates IANA timezone.
  - `today` returns 24 one-hour buckets beginning at midnight in the requested zone.
  - `24h` labels render using the requested zone.
- `src/app/api/usage/chart/route.js`
  - Reads `tz` and calls `getChartData(period, tz)`.
- `src/app/(dashboard)/dashboard/usage/components/UsageChart.js`
  - Sends `Intl.DateTimeFormat().resolvedOptions().timeZone` as `tz`.
- Tests:
  - `tests/unit/usage-period-tz.test.js` checks Los Angeles day boundaries and invalid-zone fallback.
  - `tests/unit/usage-period-routes.test.js` checks explicit timezone forwarding.

## Implemented changes (#3116, #3167)

- `open-sse/translator/concerns/toolCall.js`
  - `normalizeOpenAIToolNames(body, maxLength = 64)` sanitizes and truncates tool
    names across definitions, `tool_choice`, and conversation history, returning
    an alias → original map. Truncation carries a SHA-256 suffix so two names
    sharing a long prefix cannot collapse into one.
  - `restoreOpenAIToolNames(body, aliases)` reverses the rewrite on responses.
  - `nvidiaToolCallId` / `normalizeNvidiaToolCallIds` collapse tool-call IDs to a
    compact deterministic 9-hex identifier, rewriting the assistant call and its
    matching tool result together.
- `open-sse/handlers/chatCore.js` normalizes names for OpenAI-format targets and
  merges the aliases into the existing `toolNameMap`.
- `open-sse/executors/default.js` normalizes NVIDIA tool-call IDs and overlong
  official-OpenAI tool-call IDs.
- `open-sse/providers/registry/nvidia.js` declares `quirks.toolNameMaxLength`.

## Verification

- `tests/unit/usage-period-routes.test.js` + `tests/unit/usage-period-tz.test.js`: 18 passed.
- `tests/unit/nvidia-tool-normalization.test.js`: 12 passed.
- `tests/unit/openai-tool-call-id-normalization.test.js` + `tests/unit/openai-max-completion-tokens.test.js`: 14 passed.
- Full unit suite after all three ports: 5462 passed, 25 skipped, 0 failed.
- Revert proof: reverting each source file turns its tests red; restoring returns them green.

### Note on running these tests

`tests/vitest.config.js` excludes `**/.omc/**` and worktrees carry no
`tests/node_modules`, so running the suite from inside a worktree produces
failures that do not reproduce in the main checkout. Copy edited files into the
main checkout and run there — the earlier report of a failing `#3163` port was
this environment artifact, not a real regression.
