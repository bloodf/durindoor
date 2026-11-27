# OmniRoute #21326: private opt-in cache diagnostics

## Snapshot

- Upstream PR: [cheaper-inference/OmniRoute#21326](https://github.com/cheaper-inference/OmniRoute/pull/21326), open at inspection.
- Title: `feat(cli): add private opt-in cache diagnostics`.
- Base: `release/v3.8.55`, `16e2c146fb5b8e4ee6364fb679ffe412880757fb`.
- Head: `fix/19803-private-cache-diagnostics`, `b75d5990dddd5143229332779bf8687d66fdf829`.
- PR metadata and changed paths were read with `gh api repos/cheaper-inference/OmniRoute/pulls/21326` and `gh api repos/cheaper-inference/OmniRoute/pulls/21326/files --paginate`.
- Local comparison points: `origin/main` at `29490b783e83176d4d6a4162f76ee3dc79db66ea` and frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`.
- Existing ledger entry: [2026-11-27 full parity refresh, O0077](2026-11-27-full-parity-refresh.md#L1745) marks this exact head “Unrecorded at this head; review required.” No other report or active ownership claim for #21326 was found. The listed auth and sync claims do not overlap this feature's CLI-private diagnostics scope.

## Upstream behavior reviewed

The PR adds an opt-in Node CLI observer, disabled unless `OMNIROUTE_CACHE_DIAGNOSTICS=1`, and an optional token estimate worker enabled by `OMNIROUTE_TOKEN_BREAKDOWN=1`. It observes only selected HTTPS OpenAI/Codex transports, bounds pending requests and captured bodies, stores numeric usage and per-run keyed fingerprints through a private sink, and observes explicit logging opt-out state. Unsupported body observation/encodings are represented as unavailable. It also adds observer startup/shutdown integration, environment documentation, and focused unit/fixture tests. No route, authorization, usage settlement, or packaged compression worker behavior is changed.

Changed files comprise `.env.example`; nine runtime modules under `bin/cli/runtime/` (`cacheDiagnostics.mjs`, `cacheDiagnosticsPreload.mjs`, `cacheDiagnosticsProtocol.mjs`, `cacheDiagnosticsSink.mjs`, `processSupervisor.mjs`, `runtimeDiagnosticsLog.mjs`, `tokenBreakdown.mjs`, `tokenBreakdownContent.mjs`, `tokenBreakdownWorker.mjs`); `changelog.d/fixes/private-cli-cache-diagnostics.md`; `docs/reference/ENVIRONMENT.md`; `open-sse/handlers/chatCore.ts`; `open-sse/utils/providerRequestLogging.ts`; `scripts/build/runtime-env.mjs`; `src/lib/gracefulShutdown.ts`; and the added fixtures and tests under `tests/fixtures/token-breakdown/` and `tests/unit/` (plus `tests/unit/cli-process-supervisor.test.ts`).

## Verdict: missing behavior, P2 parity candidate

Neither specified DurinDoor tree contains the private cache-observer or token-breakdown implementation, its opt-in environment contract, or its tests. The launcher exists under `cli/`, but its current runtime helpers concern process flags, SQLite, tray, and cleanup; they do not capture provider request bodies or report provider cache usage. For example, `cli/hooks/nodeFlags.js` is heap/process configuration, not request observation. The gateway has adjacent but distinct functionality: `open-sse/handlers/chatCore/requestDetail.js` extracts ordinary usage details, `open-sse/services/usage.js` handles usage, and the token-saver UI reports compression metrics. These do not implement the PR's local, private, opt-in CLI observations and keyed within-run fingerprints.

The upstream hook points are request capture and lifecycle: `open-sse/utils/providerRequestLogging.ts`, `open-sse/handlers/chatCore.ts`, `src/lib/gracefulShutdown.ts`, and `bin/cli/runtime/processSupervisor.mjs`. The comparable DurinDoor feature is absent across both `origin/main` and the frozen train tree; there is no behavior to call present or intentional/inapplicable. The diff's `open-sse/` hook points alone do not constitute an overlap with the specified auth or sync claims, and no report records a staged owner for this CLI feature.

Evidence commands (static inspection only; no candidate code or tests executed):

```sh
git grep -n -i 'cache diagnostics\|token breakdown\|private-cache-diagnostics\|OMNIROUTE_CACHE_DIAGNOSTICS' origin/main
git grep -n -i 'cache diagnostics\|token breakdown\|private-cache-diagnostics\|OMNIROUTE_CACHE_DIAGNOSTICS' 32a783d76d45d90bf0517015442f43fadd96106c
rg -n 'diagnosticsOptOut|providerRequestCapture|runtimeDiagnostics|token.*breakdown' cli open-sse src
```

The first two searches find only the O0077 review-ledger row. The local searches find no observer or token breakdown implementation; usages of “diagnostic” for other features and compression diagnostics are not equivalent. No reproduction command is applicable without implementing the missing observer; the observed behavior is absence of the opt-in surface and recorder in both compared trees.
