# Streaming trailing usage reconciliation

Disposition: **DONE_WITH_CONCERNS**. The trailing-usage timing fix is already present through #5890. Do not port #5904 wholesale. Its top-level cache-creation alias remains missing, and its coercion of numeric strings differs from local validation. This report makes no product or test changes.

## Revisions and source evidence

Reviewed 2026-11-27, with source and open-PR refresh at approximately 11:30 UTC. Snapshots are sequential, not atomic.

- Candidate checkout: `83d0694c238042c61cff5671d1a57c1fbbc5c10a`.
- Refreshed `origin/main`: `f14f877ec13d6a9c58ed5a7d8f665526f748e76e`, fetched without changing the candidate checkout. The three implementation files and four scoped test files below have no diff between these revisions.
- 9router `master`: `5ae63d22847e07042e235b40e1d926b65e509013`.
- [9router #5890](https://github.com/decolua/9router/pull/5890): open, head `f5417e79e9c5a35f4c2a408cbce6a5a2a3bc8b2f`, base `5ae63d22847e07042e235b40e1d926b65e509013`. Four complete file patches inspected.
- [9router #5904](https://github.com/decolua/9router/pull/5904): open, head `b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`, same base. Two complete file patches inspected.

The [full census reconciliation item](2026-11-27-full-parity-refresh.md) supersedes the historical providers-only exclusion in [batch d](1072-nov27-d.md). The implementation claim in [batch b](1072-nov27-b.md) was checked against code and executed fixtures, rather than accepted from its title or SHA. The existing #5890 suite entered local history in `9e6174f1dde441caf4fd0c071082f6ad89d8bed4`, merged through local #2664.

CodeGraph query through `sh scripts/codegraph.sh query 'openaiToClaudeResponse' --limit 5 --json` returned “CodeGraph not initialized”. Ownership inspection therefore used bounded searches of the named files and related tests. No graph index was created.

## Per-head final dispositions

| Upstream head | Final disposition | Implementation and evidence |
| --- | --- | --- |
| #5890 `f5417e79e9c5a35f4c2a408cbce6a5a2a3bc8b2f` | Already ported with local architecture adaptations; preserve it | `createSSEStream` holds the finish frame in `pendingClaudeFinish`, matches a usage-only receipt, and replays the finish with its usage. `openaiToClaudeResponse` converts counts with `toClaudeUsage`. The measured branch bypasses buffer padding. Eight existing #5890 tests pass, including trailer, inline usage, EOF, sentinel and 3000 ms fallback cases. |
| #5904 `b2b7ce1c6f9437ea344c9e05d1cd743d79892eea` | Timing and ordinary numeric counter behavior already present; partial parity for the complete patch | Its translator-level pending terminal duplicates the gateway-level hold already implemented for #5890. Nested cache writes, flat cache reads, input clamping, inline usage and single terminal behavior are covered. Top-level `usage.cache_creation_tokens` is absent from local alias selection and loses counts in an executed gateway fixture. Numeric-string coercion also differs by static inspection. No second timing port is justified. |

## Path and symbol evidence

- [`open-sse/utils/stream.js`](../../../open-sse/utils/stream.js), `createSSEStream`, `isMatchingClaudeUsageTrailer`, `processLines`: the hold applies to direct OpenAI Chat upstream to Claude client streams without valid finish usage. It does not require an ID or `providerBody`. A receipt must have no choices and valid usage; conflicting present response IDs cannot donate counters. Comments, metadata and whitespace data heartbeats cannot release the hold. Buffered EOF receipts also attach before finish replay.
- The same function uses `PENDING_COMPLETION_FLUSH_MS = 3000`. At 2999 ms the completion callback has not fired; at 3000 ms it fires once. `[DONE]`, EOF or the watchdog release the held finish. Existing fallback estimates remain when no receipt arrives.
- [`open-sse/translator/response/openai-to-claude.js`](../../../open-sse/translator/response/openai-to-claude.js), `toClaudeUsage`, `openaiToClaudeResponse`, `finalizeOnFlush`: uncached input is `max(0, prompt - read - write)`. `claudeMeasuredUsage` preserves real usage against zero placeholders. `claudeFinishHandled` protects terminal emission. Pivot routes retain immediate finish behavior.
- [`open-sse/utils/usageTracking.js`](../../../open-sse/utils/usageTracking.js), `normalizeUsage`, `extractUsage`, `canonicalizeUsage`, `hasValidUsage`: cache read and write counters survive the shared accounting path. All-zero placeholders are invalid usage. Canonical, nested and cache-write aliases are supported, but top-level `cache_creation_tokens` is not. Local typed checks do not perform #5904's `Number(...)` coercion.

Literal existing gateway fixtures show these results:

| Input sequence after text | Expected and observed client result |
| --- | --- |
| Zero placeholder finish; trailer with prompt 8505, output 16, nested cached 8448 and created 7 | One terminal pair, input 50, output 16, read 8448, write 7; callback once, canonical prompt 8505. Works with a newline and sentinel, and with a trailer lacking its final newline. |
| Finish; heartbeat; trailer prompt 8505, output 16, nested cached 8448 | One terminal pair, input 57, output 16, read 8448. Comment, event metadata and three empty-data heartbeat forms are covered. |
| Finish with prompt 80, output 12, flat cached 80 | Immediate terminal pair with input 0, output 12, read 80, without the configured input buffer. Prompt 40 with cached 50 also clamps to 0. |
| Finish without trailer, followed by sentinel or EOF | Terminal with estimated usage. A stalled open upstream instead completes after the bounded 3000 ms wait. |

## Active local ownership

The paginated GitHub REST snapshot returned 16 open local PRs. Titles and bodies were inspected for all of them. The T3 repository query returned an empty collection, so the REST collection was used rather than assuming no active work.

[Local #2627](https://github.com/bloodf/durindoor/pull/2627), head `2d8065ac5df9e1543be790347b8a4b6ad7da2b24`, owns a broad repair stack. Its complete diff overlaps `stream.js` and `openai-to-claude.js`. It distinguishes gateway estimates from measurements, changes Responses margin projection and rejects interrupted tool streams. It does not add `cache_creation_tokens` alias support. Coordinate any follow-up with that owner; preserve these changes and do not reopen the completed #5890 timing port.

Complete diffs of reasoning/cancellation lanes #2635 at `69cbf42482173ac61bf013ab774c1766ed41bcf5`, #2678 at `ba4647a9298f16df70d6a73803f3ade87c296cb0`, #2680 at `1bac9a2bee8facc8492206b9420dc087920df790` and #2633 at `37d8f533ddfda1972fc997e51cef1293990f40d2` do not change these three implementation files. Other active lane titles/bodies concern CI, provider catalogs, Liquid, OpenRouter, TrustedRouter, Cursor proxy handling, Devin readiness and image cancellation. They do not claim this alias fix. This is a point-in-time ownership check, not a reservation or merge approval.

## Bounded remaining unit

Proposed unit: `parity-stream-cache-creation-alias`. Extend the existing cache-write normalization and Claude conversion to accept finite, nonnegative top-level `cache_creation_tokens` consistently. Keep canonical fields authoritative, including explicit zero. Do not replace the finish hold or introduce a second pending-terminal state machine. Recheck #2627 and main before implementation. Add shared extraction and gateway regression fixtures plus a short behavior note.

Literal acceptance fixtures:

1. Text, finish without usage, then `{choices:[], usage:{prompt_tokens:100, completion_tokens:5, cached_tokens:20, cache_creation_tokens:30}}`, then `[DONE]`: exactly one `message_delta` with `{input_tokens:50, output_tokens:5, cache_read_input_tokens:20, cache_creation_input_tokens:30}` and one `message_stop`; canonical accounting retains prompt 100 and write 30. Current gateway instead emits `{input_tokens:80, output_tokens:5, cache_read_input_tokens:20}`. This gap was reproduced, not inferred from a missing identifier.
2. The same counts under `prompt_tokens_details:{cached_tokens:20, cache_creation_tokens:30}`: retain the already working expected result above. Canonical `cache_creation_input_tokens:0` alongside alias 30 must stay zero.
3. Add an inline finish variant and verify the same exact counts without input-buffer padding. Reject negative, non-finite and malformed alias values without poisoning the stream.

A separate compatibility decision is required for numeric strings. #5904 converts `prompt_tokens:"100"`, `completion_tokens:"5"`, and nested cached `"20"` into input 80, output 5 and read 20. Local `toClaudeUsage` uses numeric type checks, and `hasValidUsage` rejects those strings. This difference was inspected statically, not exercised here. Either explicitly adapt and test that boundary or document why typed counters are the supported contract. Do not label the entire #5904 patch equivalent until that decision and the alias fix are complete. Conflicting alias precedence also differs upstream; preserve local canonical/explicit-zero rules rather than copying its precedence blindly.

## Executed evidence and limits

Installed root, CLI and test dependencies with the requested frozen-lockfile, prefer-offline commands. All completed successfully; no lockfile changes.

The exact required command, from `tests/`, passed with 33 tests:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/upstream-intake-ledger.test.js --maxWorkers=2
```

The scoped behavior run passed 53 tests across four files:

```sh
timeout 300 node node_modules/vitest/vitest.mjs run unit/upstream-intake-ledger.test.js unit/port9r-5890-claude-stream-usage.test.js unit/stream-heartbeat-usage-trailer.test.js translator/port-2279-claude-finish-guard.test.js --maxWorkers=2
```

This run used an empty child environment with only PATH, private HOME/DATA_DIR/cache/tmp paths and locale variables. No publisher/provider credentials were passed. The two temporary gateway alias probes also passed in that private environment. They assert the current missing-alias result and its supported nested control, rather than pretending the desired fix passed.

For architecture comparison, all six #5904 helper tests were reconstructed outside the repository from its fetched test patch with import paths adjusted. Three passed and three failed. Failures were translator-only expectations that the finish call itself withholds terminal events and that a later trailer or null flush emits them. Locally `createSSEStream` owns that hold, so calling the translator directly bypasses it. These failures are reported as a helper-contract difference, not hidden or treated as a gateway regression. The real gateway fixtures above establish the timing behavior. The temporary probe initially failed collection because Vitest mock hoisting did not recognize an absolute Vitest import; using a normal Vitest import with an external alias fixed collection. No repository test was edited or weakened.

Temporary probe source/config and upstream comparison output were kept under `/tmp/parity-stream-evidence/`; they are disposable, untracked evidence. The literal fixtures here remain the durable reproduction specification. No full suite, build, live provider request or service operation ran. Failure baseline unchanged. Only this report is committed; full local CI and independent cross-family review remain required for any later product PR.
