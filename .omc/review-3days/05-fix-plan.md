# 05 - Fix plan (consolidated, post all lanes)

**Range:** `cfb25e641..origin/dev` (353 commits, 904 files)
**Source-of-truth severity** comes from each report's own `### P0` / `### P1` / `### P2` headers. Report-local [INFERENCE] markers are preserved inline.

## P0 from `02-providers-executors.md` (11 items, in report order)

1. **Codex `_isCompact` is read before it is set** (`open-sse/executors/codex.js:211` + `base.js:139` + `codex.js:381`): shared executor state; stale `/compact` URL leaks.
2. **Codex SSE peek matches transient/error substrings before user output** (`open-sse/executors/codex.js:303-308`): legitimate stream containing "capacity" / "server_is_overloaded" gets aborted as synthetic 503.
3. **VeoAIFree concrete executor shadowed by `UnsupportedOmniRouteWebSessionExecutor`** (`open-sse/executors/unsupported-websession.js:76`, `executors/index.js:93-103`): real executor ready, every request returns 501. Confirmed by `tests/__baseline__/known-fails.txt`.
4. **Zenmux Free `ctoken` leaks in `url.toString()` for every result** (`open-sse/executors/zenmux-free.js:277,296-360`): token in logs, error responses, telemetry. **Security.**
5. **Zenmux Free `decodeURIComponent` outside try/catch** (`open-sse/executors/zenmux-free.js:22`): malformed ctoken throws `URIError` instead of 401.
6. **Pollinations keyless catalog not recognized as no-auth** (`open-sse/providers/registry/pollinations.js:17`, `src/sse/services/auth.js:61`): keyless request fails auth. Confirmed by `tests/__baseline__/known-fails.txt:62-64`.
7. **Kiro region resolver ignores `profileArn`** (`open-sse/executors/kiro.js:53-64`, `kiroConstants.js:21-22`, `kiro.js:9`): IdC `eu-central-1` routed to `us-east-1`. Confirmed by `tests/__baseline__/known-fails.txt:19-26`.
8. **Kiro SSE parser unbounded buffer + silent frame-count truncation** (`open-sse/executors/kiro.js:~160-180`, `maxIterations=1000`): memory exhaustion or truncated response.
9. **Pollinations `buildUrl` fallback hardcodes URL** (`open-sse/executors/pollinations.js:12`, `registry/pollinations.js:19-20`): executor ignores registry URL changes.
10. **CLIProxyAPI URL fallback swallows settings import errors** (`open-sse/executors/cliproxyapi.js:15-23`): user `CLIPROXYAPI_URL` silently falls back to `127.0.0.1:8317`.
11. **Antigravity `AG_DEFAULT_TOOLS` missing `mcp_sequential-thinking_sequentialthinking`** (`open-sse/executors/antigravity.js:515-563` + `appConstants.js:108-130`): real AG response renamed with `_ide` suffix, breaking tool round-trip.

## P0 from other reports

- **P0.A - Migration registry missing two migrations; per-key policy non-functional** (`03-db-migrations.md` + cascade in `04-dashboard-sse.md`): `src/lib/db/migrations/index.js:4-9` does not import `004-api-key-expiry.js` or `005-api-key-policy.js`; two files share `version: 4`. `src/sse/handlers/chat.js:138-154` reads missing columns, policy is silently a no-op.
- **P0.B - Baseline grew +16** (`01-process.md`): AGENTS.md hard gate violation. Top regressed: `mitm-rootca-autogen.test.js` (+5), `xai-oauth-service.test.js` (+5), `translator-request-normalization.test.js` (+4).

## P1 - sourced from reports' own `### P1` headers

### From `02-providers-executors.md` (18 items, in report order #12-#29)

12. Codex `body.include` is clobbered when reasoning is enabled (`codex.js:445-446`).
13. Codex usage dispatcher omits `providerSpecificData` (`services/usage.js:37`, `services/usage/codex.js:40-63`).
14. Antigravity `cloakTools` dead code (`antigravity.js:418-514`).
15. MiMo Free JWT cache writes before expiry validated (`mimo-free.js:61-78`).
16. Chipotle client pool reuses stale pooled WebSockets (`chipotle.js:233-253`).
17. WebSession utilities abort-signal merge leaks listeners (`websession-utils.js:13-25`).
18. GitLab Duo registry `oauth.defaultBaseUrl` ignores self-managed instances (`gitlab-duo.js:26`). Confirmed by `tests/__baseline__/known-fails.txt:55`.
19. Kiro `kiroConstants.js` imports full OAuth registry on SSE hot path (`kiroConstants.js:3`).
20. Antigravity `buildIdeRequestId` fingerprints same IDE identity for CLI alias `agy` (`agy.js:8`).
21. Kiro static registry models duplicate dynamic expansion (`registry/kiro.js:42-58`).
22. No-auth `getProviderCredentials` fallback for excluded/locked real keys (`auth.js:137-148`). Confirmed by `tests/__baseline__/known-fails.txt:62-64`.
23. CommandCode registry has duplicate entries for `commandcode` and `command-code` (`registry/commandcode.js`, `registry/command-code.js`).
24. Antigravity registry lost the sandbox fallback URL (`registry/antigravity.js:22`).
25. Antigravity `uuidFromSeed` deterministically hashes PII-bearing seeds (`antigravity.js:100-110`) `[INFERENCE]`.
26. Codex `buildHeaders` sets `session_id` from stale instance state (`codex.js:207,384`).
27. VeoAIFree `fetchWithTimeout` duplicates `websession-utils` logic (`veoaifree-web.js:16-43`).
28. VeoAIFree blocked test asserts the wrong behavior (test-only, `tests/unit/omniroute-websession-blocked.test.js:82-91` vs runtime test).
29. API-key policy CLI bypass is broad (`apiKeyPolicy.js:16-20`).

### From other reports

- **P1.C - Branch protection + required checks on `dev` and `main`** (`01-process.md`): `gh api -i .../protection` returns `HTTP/2 404 Not Found` for both.
- **P1.D - Codex PR review was bypassed for many window PRs** (`01-process.md`): 22 of 72 window PRs had 0 review submissions.
- **P1.E - `clampToModelMaxOutput` cap mismatch for volcengine-ark glm-5** (`02-translator.md`): `paramSupport.js:25` resolves to 128k via `*glm-5*` pattern, but upstream Kimi cap is 32k per PR #108.
- **P1.F - `message.js` collapse change widens contract; stale JSDoc** (`02-translator.md`): `message.js:3-5` joins multi-text parts; no test for Claude-as-target with two text parts.
- **P1.G - `claude` provider golden test absorbed into baseline** (`02-translator.md`): `tests/translator/__snapshots__/golden-url-header.test.js.snap`; baseline entry on line 9.
- **P1.H - `getApiKeyUsageLimitStatus` may not guard missing `apiKeyUsageTotals` table** (`04-dashboard-sse.md`): tied to P0.A.
- **P1.I - Release workflow stale comments + dead ignore rule** (`04-ci-scripts.md`): `release.yml:15-19` uses `npm ci` + `cache: npm`; root `package-lock.json` IS tracked in git (verified via `git ls-files`); `ci.yml:31-33` comment stale; `.gitignore:61` dead rule.
- **P1.J - RTK git-log regex may false-positive on prose with `commit <hex>` substring** (`03-rtk-cli-headroom.md`): `autodetect.js:21-22` permissive.
- **P1.K - `CLI_AUTH_SALT` static string in `apiKeyPolicy.js:8`** (`04-dashboard-sse.md`): public source, low risk, document.
- **P1.L - `scripts/migrate-from-9router.mjs` provider-label rewrite scope changed** (`03-rtk-cli-headroom.md`).

## P2 - sourced from reports' own `### P2` headers

### From `02-providers-executors.md` (3 items, #30-#32)

30. Zenmux Free `authType` duplicated at root and transport (`zenmux-free.js:14,20`).
31. Kiro `buildKiroProfileEndpoint` may return `https://undefined` when no amazonaws host is available (`kiroRegions.js:75-81`) `[INFERENCE]`.
32. Codex `_peekSseTransientError` re-reads the same body twice when no error is matched (`codex.js:318-333`) `[INFERENCE]`.

### From other reports

- `open-sse/translator/concerns/paramSupport.js:1` - inline `capabilities` import; consolidate via barrel.
- `open-sse/translator/concerns/paramSupport.js:35-39` - `clampNumber` does not signal whether it ran.
- `src/lib/oauth/**` (cursor auto-import, gitlab pat, xai oauth) - not read in this pass.
- `src/lib/network/connectionProxy.js:6-33` - 27-line insertion in critical proxy path; not read.
- `src/lib/headroom/**`, `src/lib/pxpipe/**` - spot-checked only; full read needed.
- `scripts/build-cli.js`, `scripts/build-app.js` - not read.
- `src/lib/usagePeriods.js` - `getChartDayBucketCount` is a no-op wrapper.
- `docs/**` - rebrand completeness check (orphan 9router references); Farsi i18n UX.
- `AGENTS.md` vs current code - periodic re-audit; no clear drift in this pass.

## Unverified backlog (not in any report's P0/P1/P2)

These are my self-written observations that the sub-agent did not corroborate. Treat as `[INFERENCE]` until a follow-up read confirms them.

- `open-sse/providers/registry/9router.js` - provider literally named "9router" shipped in DurinDoor rebrand.
- `open-sse/providers/registry/agy.js` - re-exports `antigravity`; future changes silently apply.
- `open-sse/providers/index.js:36-38` - system-category entries without transport excluded from `PROVIDER_MODELS`.
- `open-sse/providers/capabilities.js:160-187` - HuggingChat `vision: false` finalizer.
- `open-sse/providers/models/schema.js:5-13` - `normalizeModelId` digit-hyphen-to-dot may collide.
- `open-sse/providers/index.js:9-22` - `buildTransport` `entry.thinkingFormat` overrides `transport.thinkingFormat`.
- `open-sse/providers/pricing.js:298-303` - three cost shapes accepted; log on non-numeric `cost_usd`.

## Sequencing

| Order | Item | Why first |
|---|---|---|
| 1 | P0 #4 (Zenmux ctoken leak) | Security: token in logs |
| 2 | P0.A (migrations) | Blocks per-key policy; cascades into P1.H |
| 3 | P0.B (baseline) | AGENTS.md hard gate |
| 4 | P0 #7 (Kiro region) | Auth regression; user-facing |
| 5 | P0 #3 (VeoAIFree) | Functional regression; user-facing |
| 6 | P0 #6 (Pollinations no-auth) | Functional regression; user-facing |
| 7 | P0 #1, #2 (Codex compact/SSE peek) | Functional regression |
| 8 | P0 #5, #8, #9, #10, #11 (Zenmux URIError, Kiro SSE, Pollinations URL, CLIProxyAPI fallback, Antigravity tool name) | Remaining provider P0 |
| 9 | P1.C + P1.D (branch protection) | Prevents recurrence; cheap |
| 10 | P1.E, F, G (translator runtime) | Independent |
| 11 | P1.I (release hardening) | Stale comments + ignore rule |
| 12 | P1.J (RTK regex) | After P0.A so behavior is stable |
| 13 | Provider P1 list (#12-#29) | Bundle by file family |
| 14 | P2 + unverified backlog | Polish |

## PR size budget

- P0 #4 (Zenmux ctoken): 1 source file, 1 test file.
- P0.A migrations: 4 files (registry, two migration files, `schema.js`), 1 new test file.
- P0.B baseline: 1 source fix per absorbed test, batched into 3-5 PRs by failure class.
- P0 #7 (Kiro region): 1 source file, 1 test file.
- P0 #3 (VeoAIFree): 1 source file, 1 test file.
- P0 #6 (Pollinations): 1 source file, 1 test file.
- P0 #1, #2 (Codex): 1 source file, 1 test file.
- P1.C: GitHub UI only. No code change.
- P1.E, F, G: 1 source file + 1 test file each.
- P1.I: 3 files (release.yml, ci.yml, .gitignore).
- P1.J: 1 source file, 1 test file.
- Provider P1 list: bundle into 2-3 PRs by file family (Codex, Kiro, Antigravity).

## Process regression to flag separately

The orchestrator's `task` sub-agents repeatedly claimed "file written" without the file landing on disk, even when given absolute paths and `ls -la` verification. Three of the four parallel lanes (RtkCliHeadroomReview, DashboardSseReview, DocsRebrandReview) had to be re-dispatched; two were cancelled without producing a file. The orchestrator wrote the missing reports directly. After re-dispatching, the providers lane finally wrote `02-providers-executors.md` (more complete than the orchestrator's self-copy). Recommendation: do not trust sub-agent "done" without verifying the file exists on disk with `test -s`.

## Source artifacts

- `.omc/review-3days/01-process.md` - governance review
- `.omc/review-3days/02-translator.md` - translator pipeline
- `.omc/review-3days/02-providers-executors.md` - providers + executors + config (32 findings: 11 P0, 18 P1, 3 P2)
- `.omc/review-3days/03-db-migrations.md` - DB / migrations
- `.omc/review-3days/03-rtk-cli-headroom.md` - RTK + CLI + headroom + pxpipe
- `.omc/review-3days/04-ci-scripts.md` - CI + scripts + commitlint
- `.omc/review-3days/04-dashboard-sse.md` - SSE + OAuth + network
- `.omc/review-3days/07-docs-rebrand.md` - docs + rebrand + gitbook
- `.omc/review-3days/baseline-stats.txt` - regression breakdown
