# OmniRoute #21326: private opt-in cache diagnostics

## Snapshot

- Upstream PR: [cheaper-inference/OmniRoute#21326](https://github.com/cheaper-inference/OmniRoute/pull/21326), open at inspection.
- Title: `feat(cli): add private opt-in cache diagnostics`.
- Base: `release/v3.8.55`, `16e2c146fb5b8e4ee6364fb679ffe412880757fb`.
- Head: `fix/19803-private-cache-diagnostics`, `b75d5990dddd5143229332779bf8687d66fdf829`.
- Upstream source pin: the base and head SHAs above, the title, and the changed-file list come from the first report's `gh api` reads of `repos/cheaper-inference/OmniRoute/pulls/21326` and `.../files`. **This correction did not independently re-fetch upstream; all upstream behavior below is carried from that first report.**
- Local comparison points: `origin/main` at `29490b783e83176d4d6a4162f76ee3dc79db66ea` and frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`. Local worktree HEAD at correction time: `e380276ed9`.
- Existing ledger entry: [2026-11-27 full parity refresh, O0077](2026-11-27-full-parity-refresh.md) marks this exact head “Unrecorded at this head; review required.” No other report or active ownership claim for #21326 was found. The listed auth and sync claims do not overlap this feature's CLI-private diagnostics scope.

## Upstream behavior reviewed

The PR adds an opt-in Node CLI observer, disabled unless `OMNIROUTE_CACHE_DIAGNOSTICS=1`, and an optional token estimate worker enabled by `OMNIROUTE_TOKEN_BREAKDOWN=1`. As described upstream, it observes only selected HTTPS OpenAI/Codex transports, bounds pending requests and captured bodies, stores numeric usage and per-run keyed fingerprints through a private sink, and observes explicit logging opt-out state. Unsupported body observation/encodings are represented as unavailable. It also adds observer startup/shutdown integration, environment documentation, and focused unit/fixture tests. No route, authorization, usage settlement, or packaged compression worker behavior is changed.

Changed files, per the first report: `.env.example`; nine runtime modules under `bin/cli/runtime/` (`cacheDiagnostics.mjs`, `cacheDiagnosticsPreload.mjs`, `cacheDiagnosticsProtocol.mjs`, `cacheDiagnosticsSink.mjs`, `processSupervisor.mjs`, `runtimeDiagnosticsLog.mjs`, `tokenBreakdown.mjs`, `tokenBreakdownContent.mjs`, `tokenBreakdownWorker.mjs`); `changelog.d/fixes/private-cli-cache-diagnostics.md`; `docs/reference/ENVIRONMENT.md`; `open-sse/handlers/chatCore.ts`; `open-sse/utils/providerRequestLogging.ts`; `scripts/build/runtime-env.mjs`; `src/lib/gracefulShutdown.ts`; and the added fixtures and tests under `tests/fixtures/token-breakdown/` and `tests/unit/` (plus `tests/unit/cli-process-supervisor.test.ts`).

## Verdict: low severity, deferred optional diagnostics parity

This is an optional, disabled-by-default CLI diagnostics feature. It is **not** an existing security or correctness defect in DurinDoor, and it should not be scheduled as a P2 parity candidate. Priority: **low / deferred**.

What DurinDoor already has, locally:

- **Numeric cache usage is already exposed in request details.** `open-sse/handlers/chatCore/requestDetail.js:117-118` reads cache-read tokens from `cache_read_input_tokens`, `cached_tokens`, or `prompt_tokens_details.cached_tokens`, and cache-creation tokens from `cache_creation_input_tokens`. `formatDoneLine` (`requestDetail.js:120-128`) renders them as `↻<n>` and a `% reused` figure.
- **Combo no-log already strips payloads.** `open-sse/handlers/chatCore/requestDetail.js:85-90` sets `request`, `providerRequest`, and `providerResponse` to `null` when `comboNoLog === true`, before the detail reaches storage. `comboNoLog` is threaded through `open-sse/handlers/chatCore.js` (signature at line 403) and the streaming, non-streaming, and SSE-to-JSON handlers.
- **Content masking is already a chat-core input.** `contentMasking` is a parameter of `runChatCore` in `open-sse/handlers/chatCore.js:403`.
- **`DATA_DIR` is the established private-data root.** `src/lib/auth/dashboardSession.js:188` resolves private files under `DATA_DIR` via `src/lib/dataDir`.

What is missing (the actual delta):

- The opt-in CLI observer and its env contract (`OMNIROUTE_CACHE_DIAGNOSTICS`, `OMNIROUTE_TOKEN_BREAKDOWN`).
- Per-run keyed prefix fingerprints. Nothing in DurinDoor computes keyed within-run fingerprints of request prefixes.
- The token-breakdown estimate worker.

The existing cache-usage fields are **not** a substitute for fingerprints or breakdown estimates; they only report what the provider returned.

The upstream hook points named in the first report (`open-sse/utils/providerRequestLogging.ts`, `src/lib/gracefulShutdown.ts`, `bin/cli/runtime/processSupervisor.mjs`) use upstream paths. Local checks found no `open-sse/utils/providerRequestLogging*` and no `src/lib/gracefulShutdown*`. DurinDoor's launcher under `cli/` has `cli/hooks/nodeFlags.js` (heap/process flags) and a `sqliteRuntime.js`, `trayRuntime.js`, and `cleanupMitmHosts.js` set; none capture request bodies or report provider cache usage. So there is no local behavior to call present or intentionally inapplicable: the feature is absent in both `origin/main` and the frozen train tree.

## Design requirements for any future port

These are requirements a port must meet. They are **not** guarantees that exist today.

1. **Strict OpenAI/Codex host allowlist.** The observer must match exact hosts and paths, not substrings. Local OpenAI/Codex endpoints that a port would need to consider include `https://api.openai.com/v1/...` and `https://chatgpt.com/backend-api/codex/responses` (`open-sse/AGENT-INDEX.md:183`, `:382`). The exact allowlist must be taken from the upstream code, which this review did not re-read.
2. **Never persist headers or raw bodies.** The sink stores only numeric usage and keyed fingerprints.
3. **Honor combo noLog and content masking.** Observation must be skipped or fully redacted when `comboNoLog` is set, and masked content must never reach the fingerprint or estimate path. Today's guarantee is only the post-hoc payload strip in `requestDetail.js:85-90`; a port must not weaken it.
4. **Write private data under `DATA_DIR`.** Not under the CLI install directory, and not under a fixed `~/.9router` path.
5. **Coordinate with #21317 affinity scoping.** [#21317](review-omni-21317-prompt-cache-affinity.md) changes how prompt-cache affinity keys are scoped to authenticated sessions. Per-run fingerprints must use a key scope that does not diverge from that affinity scope, or the diagnostics will misreport cache reuse. Sequence the two ports; do not port #21326 first in isolation.

Established guarantees (already true, verified locally): combo noLog strips detail payloads (`requestDetail.js:85-90`); numeric cache usage is already surfaced (`requestDetail.js:117-128`); `DATA_DIR` is the private root (`dashboardSession.js:188`). Everything in the list above under "Design requirements" is unverified until implemented.

## Evidence commands

Static inspection only. No candidate code, tests, installs, services, or network calls were used for this correction.

```sh
git grep -n -i 'cache diagnostics\|token breakdown\|private-cache-diagnostics\|OMNIROUTE_CACHE_DIAGNOSTICS' origin/main
git grep -n -i 'cache diagnostics\|token breakdown\|private-cache-diagnostics\|OMNIROUTE_CACHE_DIAGNOSTICS' 32a783d76d45d90bf0517015442f43fadd96106c
git grep -n -i 'cache_read_input_tokens\|cached_tokens\|cache_creation_input_tokens' -- open-sse/handlers/chatCore/requestDetail.js
git grep -n 'comboNoLog' -- open-sse/handlers/chatCore/requestDetail.js
git grep -n 'DATA_DIR' -- src/lib/auth/dashboardSession.js
git grep -n '21317' -- internal/docs/port-reports
```

The first two searches find only the O0077 review-ledger row. The local searches find no observer or token-breakdown implementation; uses of “diagnostic” for other features and compression diagnostics are not equivalent. No reproduction command is applicable without implementing the missing observer; the observed behavior is absence of the opt-in surface and recorder in both compared trees.
