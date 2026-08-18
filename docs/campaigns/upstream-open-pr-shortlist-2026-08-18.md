# Upstream Port Batch — 9router + OmniRoute (2026-08-18)

_Fork baseline: `bloodf/durindoor@main` (`864e5efca`, v3.16.3). Branch: `port/upstream-batch-2026-08-18`._

Upstream tips at port time: `decolua/9router` → `upstream/master` (`699edac32`),
`diegosouzapw/OmniRoute` → `upstream-omni/release/v3.8.50` (`40e8084b8`).

## Method

Every candidate was verified against live fork source before any code was written. Each PR was
diffed against its upstream tip (`git diff upstream/master...pr-<N>`), then applied manually
hunk-by-hunk — never cherry-picked, because the histories have diverged. A candidate whose fix was
already present in DurinDoor is recorded `DUPLICATE` with the fork `file:line` that proves it; a
candidate whose target subsystem does not exist here is recorded `NOT-APPLICABLE` with the searches
that establish absence.

Verification per item: the item's own test file must pass. Verification for the batch:
`cd tests && npm run test:ci` (full vitest run plus the `__baseline__` no-regression gate),
`npm run lint`, and `npx commitlint --from=origin/main --to=HEAD`.

## Batch result

| Gate | Result |
| --- | --- |
| `npm run test:ci` | **0 raw failures**, 0 known-failures still failing, 0 stale baseline entries |
| `npm run lint` | **0 errors** (188 warnings; 190 pre-existing at `origin/main` — net −2) |
| `npx commitlint --from=origin/main --to=HEAD` | exit **0** across all 21 commits |
| `npm run check:registry-index` | `registry/index.js is up to date.` |
| `tests/__baseline__/known-fails.txt` | unchanged — no entries added |

Tally over the 28 audited candidates: **14 PORTED**, **7 DUPLICATE**, **3 NOT-APPLICABLE**,
**2 PARTIAL (ported subset)**, **2 DEFERRED**.

## Part A — Headroom dashboard proxy fix

| Source | Title | Size | Decision | Evidence |
| --- | --- | --- | --- | --- |
| [9router #3326](https://github.com/decolua/9router/pull/3326) | rewrite dashboard static asset paths + apply rewrite to sub-pages | +9/−5, 1 file | **PORTED** `3ce87842a` | `tests/unit/headroom-proxy-rewrite.test.js` (5 cases) |

Fixes the reported bug: `https://<host>/api/headroom/proxy/dashboard` rendered broken because
`rewriteDashboardHtml()` rewrote only four `fetch('...')` endpoints and `proxy()` rewrote HTML only
for the exact path `dashboard`. Static assets, the `settings` fetch, and sub-pages such as
`/dashboard/settings` now all resolve through the proxy prefix.

## Part B — Ported

| # | Source | Title | Size | Decision | Test evidence |
| --- | --- | --- | --- | --- | --- |
| 5 | [9router #3320](https://github.com/decolua/9router/pull/3320) | Antigravity IDE fingerprint → 2.5.5 | +3/−3 | **PORTED** `71e745f4a` | `port-3320-antigravity-fingerprint.test.js`; follow-up `dc1284a5f` un-pins 2.1.1 in 3 existing tests |
| 16 | [9router #3314](https://github.com/decolua/9router/pull/3314) | prevent native SQLite install at CLI startup | +90/−10, 4 files | **PORTED** `fc00b1e9b` | `port-3314-cli-no-native-sqlite.test.js` (2) |
| 6 | [omni #10372](https://github.com/diegosouzapw/OmniRoute/pull/10372) | default `debugMode` to false in settings defaults | +54/−1, 3 files | **PORTED** `ec865d468` | `port-10372-debugmode-default.test.js` (3) |
| 7 | [omni #10366](https://github.com/diegosouzapw/OmniRoute/pull/10366) | PATCH handler on the provider connection route (CLI rotate 405) | +58/−0, 3 files | **PORTED** `ba5b4fd7f` | `port-10366-provider-connection-patch.test.js` (2) |
| 10 | [9router #3316](https://github.com/decolua/9router/pull/3316) | log the actual Codex service tier | +48/−0, 2 files | **PORTED** `7d8753189` | `port-3316-codex-service-tier.test.js` (3) |
| 27 | [omni #10400](https://github.com/diegosouzapw/OmniRoute/pull/10400) | derive `imageToText` + chutes `dots.ocr` seed | +35/−4, 3 files | **PORTED (data slice)** `a0d51b8bc` | `port-10400-chutes-ocr-seed.test.js` (3) |
| 12 | [9router #3222](https://github.com/decolua/9router/pull/3222) | synthesize a terminal when upstream drops mid-response | +153/−10, 3 files | **PORTED (applicable half)** `26a0a3aac` | `port-3222-stream-terminal-synthesis.test.js` (3) |
| 17 | [omni #10370](https://github.com/diegosouzapw/OmniRoute/pull/10370) | canonicalize provider aliases in health matrix | +92/−15, 2 files | **PORTED (narrowed)** `efb26a7a6` | `port-10370-health-matrix-alias-canonicalization.test.js` (6) |
| 21 | [9router #3295](https://github.com/decolua/9router/pull/3295) | ollama-local debug diagnostics + timeout tuning | +186/−2, 4 files | **PORTED** `8d7951bcf` | `port-3295-ollama-local-diagnostics.test.js` (10) |
| 25 | [9router #3211](https://github.com/decolua/9router/pull/3211) | add Novita AI provider support | +75/−0, 8 files | **PORTED** `a643fab79` | `novita-provider.test.js` (4); registry index + golden snapshots (`4e4ab33f2`) |
| 9 | [9router #3321](https://github.com/decolua/9router/pull/3321) | versioned UA + real client IP for zen free models | +92/−4, 2 files | **PORTED (IP half)** `f7f32ebef` | `port-3321-opencode-ua-client-ip.test.js`; 18 tests across 3 files |
| 13 | [9router #3245](https://github.com/decolua/9router/pull/3245) | inject system prompt with the target API's content-part type | +70/−5, 2 files | **PORTED** `c72cb7ba9` | `port-3245-rtk-system-part-type.test.js` (2); 36 systemInject tests green |
| 8 | [omni #10394](https://github.com/diegosouzapw/OmniRoute/pull/10394) | guard search providers from OpenAI fallback | +74/−0, 2 files | **PORTED** `6361d71be` | `port-10394-search-openai-fallback-guard.test.js` (4) |
| 14 | [9router #3252](https://github.com/decolua/9router/pull/3252) | curated custom-provider list suppresses live catalog | +111/−19, 2 files | **PORTED** `15e1ba938` | `port-3252-curated-vs-live-catalog.test.js` (3); 19/19 with adjacent suites |
| 15 | [9router #3315](https://github.com/decolua/9router/pull/3315) | retry fake-overload HTTP 200 responses | +141/−5, 2 files | **PORTED** `b22f86dd7` | `codex-overload-3232.test.js` (4); 22 codex regression tests green |
| 20 | [omni #10402](https://github.com/diegosouzapw/OmniRoute/pull/10402) | rotate to the next account on network throws | +918/−103, 10 files | **PORTED (scoped)** `ae6098255` | `port-10402-account-rotation.test.js` (10), `port-10402-rotate-on-network-throw.test.js` (4); `account-fallback-request-errors.test.js` still green |
| 19 | [omni #10392](https://github.com/diegosouzapw/OmniRoute/pull/10392) | normalize lowercase tool call names to PascalCase for Claude | +202/−60, 8 files | **PORTED** `200d22637` | `port-10392-claude-tool-name-pascalcase.test.js` (15); full translator suite 871 passed |

### Notes on the narrowed ports

- **#3222** — our `stream.js` already synthesizes terminals via `upstreamTerminal.observe(...)`. The
  genuinely missing half was that `createTerminalTracker` keyed off `targetFormat`, which is the
  wrong format in both translating branches. `buildTransformStream` now returns the format actually
  emitted to the client and the tracker keys off that.
- **#10370** — DurinDoor has no provider health matrix; the same alias-drift concern applies to the
  per-provider grouping in `src/lib/healthMonitor.js`, which now canonicalizes through our own
  `resolveProviderAlias` rather than OmniRoute's hardcoded alias table.
- **#3321** — the versioned-UA half was rejected: it contradicts existing fork contracts in
  `opencode-cli-headers-synthesis.test.js` and `opencode-official-headers.test.js`. The client-IP
  half was ported, sourced from the unspoofable `x-9r-real-ip` stamped by `custom-server.js`, and
  never forwards loopback/private addresses.
- **#10402** — scoped to `mimocode`, the only executor here with real rotation infrastructure.
  Network-throw rotation is gated on the account having a dedicated proxy, and 4xx request errors
  still do not rotate, preserving the already-ported 9router #3181.
- **#10400** — the upstream OCR-registry derivation module has no DurinDoor equivalent; the chutes
  `serviceKinds` seed follows our existing per-provider convention instead.

## Part B — Already fixed here (DUPLICATE)

| # | Source | Title | Decision | Fork evidence |
| --- | --- | --- | --- | --- |
| 1 | [9router #3301](https://github.com/decolua/9router/pull/3301) | JSON content-type when client omits `stream` | **DUPLICATE** | `open-sse/handlers/chatCore/streamFlag.js:29`; covered by `resolve-stream-flag.test.js:37` |
| 2 | [9router #3238](https://github.com/decolua/9router/pull/3238) | kiro `systemPrompt` causes REQUEST_BODY_INVALID | **DUPLICATE** | `open-sse/executors/kiro.js:292-320` strips it for `.kiro.dev`; pinned by `port-3238-kiro-system-prompt.test.js` (`cfe5c0f0d`) |
| 3 | [9router #3215](https://github.com/decolua/9router/pull/3215) | CORS for preflight OPTIONS | **DUPLICATE** | `src/dashboardGuard.js:328-343`, byte-identical, from the earlier #3025 port; `dashboard-guard.test.js:80-91` |
| 11 | [9router #3220](https://github.com/decolua/9router/pull/3220) | bound non-streaming body reads, 504 on stall | **DUPLICATE** | landed as `a9e02aacf`; `open-sse/utils/bodyTimeout.js` + `nonStreamingHandler.js:349-400`; pinned by `port-3220-nonstreaming-read-timeout.test.js` (`cfe5c0f0d`) |
| 23 | [9router #3313](https://github.com/decolua/9router/pull/3313) | SSRF guard when testing provider node | **DUPLICATE** | fixed independently as `c8fc0b780`; `open-sse/utils/outboundUrlGuard.js`; `provider-nodes-validate-ssrf.test.js` (9 cases) |
| 26 | [9router #3231](https://github.com/decolua/9router/pull/3231) | Qoder Cantus fallback model | **DUPLICATE** | landed as `3e6ba90d2`; `open-sse/services/qoderModels.js:138-166`; `qoder-cmodel-3231.test.js` (3) |

`#3313` carries one deliberate ceiling: `guardedProbeFetch` classifies the URL hostname pre-connect
and does not re-validate resolved addresses, so DNS rebinding is out of scope. Upgrade path if that
becomes a real threat model: an undici dispatcher with a DNS-validating connect hook, mirroring
upstream's `createPublicOnlyLookup`.

## Part B — Not applicable to this fork

| # | Source | Title | Decision | Basis |
| --- | --- | --- | --- | --- |
| 4 | [9router #3219](https://github.com/decolua/9router/pull/3219) | stop truncating upstream error text | **NOT-APPLICABLE** | our `markAccountUnavailable` derives `lastError` from a fixed `reasonCode` → string map, never from raw `errorText`; repo-wide search for `slice(0, 100)` in `open-sse/` and `src/` returns zero matches |
| 18 | [omni #10397](https://github.com/diegosouzapw/OmniRoute/pull/10397) | dedupe header-budget drop warns | **NOT-APPLICABLE** | patches `chatCore/responseHeaders.ts`; no such module here and no forwarded-header byte-budget mechanism exists (searched `FORWARDING_HEADER_BUDGET`, `buildStreamingResponseHeaders`, `droppedHeader`, and every `.ts` under `open-sse/`) |
| 28 | [9router #3318](https://github.com/decolua/9router/pull/3318) | wrap array tool outputs for Gemini/Antigravity `functionResponse` | **DEFERRED** | see below |

## Part B — Deferred out of this batch

| # | Source | Title | Size | Reason |
| --- | --- | --- | --- | --- |
| 22 | [9router #3325](https://github.com/decolua/9router/pull/3325) | adaptive unsupported parameter stripper | +296/−4, 4 files | Port did not converge. It must compose with our existing config-driven `getModelStrip`/`PROVIDER_MODELS.strip` rather than add a competing stripper; the attempt left an unwired `open-sse/utils/adaptiveStripper.js` with no callers and no tests, which was removed. Re-attempt as a dedicated PR that starts from our strip config. |
| 24 | [9router #3261](https://github.com/decolua/9router/pull/3261) | rotate no-auth pools after rate limits | +610/−14, 6 files | Port did not converge. Requires restructuring the `connectionId === "noauth"` early-return guards in `src/sse/services/auth.js` (`markAccountUnavailable` L800, `clearAccountError` L999), threading `excludeProxyPoolIds` through `getProviderCredentials`/`buildPublicNoAuthCredential`, and matching edits in `chat.js`. Only 2 of 6 files were partially edited and no test was written, so the partial state was reverted. |
| 28 | [9router #3318](https://github.com/decolua/9router/pull/3318) | wrap array tool outputs for Gemini/Antigravity | +751/−82, 15 files | Port did not converge. The attempt drifted well outside the PR (Dockerfile, docker-compose, `errorConfig.js`), corrupted `open-sse/executors/antigravity.js` mid-run, clobbered the `#3320` Antigravity user agent, and produced no tests. All of it was reverted. The translator core (`functionResponse` object-wrapping) is still worth porting as a focused standalone PR. |

## Explicitly out of scope (recorded, not attempted)

**9router:** #3255 (latency monitoring, +1058), #3250 (opencode-go plan usage), #3267 (catalog dump),
#3273 (sessions tab), #3277/#3280 (mega-PRs, +4900), #3257 (fingerprint anti-ban — ToS-sensitive),
#3258 (MiniMax video), #3272 (Oh My Pi CLI), #3276 (cursor HTTP/2 tunnel — needs infra),
#3319/#3297 (drafts), #3259 (unscoped), #3309 (icon asset only), #3310/#3311 (Xiaomi — needs
regional testing), #3265 (ZDR toggle — product decision), #3268 (image fast tier), #3284/#3291
(skills/plugins — separate track), #3317 (OpenClaude — separate track).

**OmniRoute:** #10362 (draft, +5079), #10409 (draft), #10358 (GLM-5.3 — model catalogs diverge),
#10359/#10367/#10382/#10390 (electron packaging — we have no electron build), #10403–#10408
(deps/CI for their repo), #10375 ("Main"), #10383 (their-catalog-specific test), #10386 (CSP embed —
product decision), #10396 (re-export of `resolveOpencodeConfigDir`), #10398 (Vertex DeepSeek-OCR —
depends on their OCR registry shape), #10363 (OpenRouter ref-image edits), #10371/#10373/#10376/#10380
(depend on OmniRoute-only executor-contract/CLIProxy code absent here).

## Previously ported — excluded up front

`#3213`, `#3217`, `#3241`, `#3243`, `#3247`, `#3254` were flagged `[ALREADY-PORTED]` during the audit
and were not re-attempted.
