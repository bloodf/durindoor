# DurinDoor Login and Upstream Port Campaign Implementation Plan

> **For agentic workers:** Execute with `durindoor-reviewed-port-campaign` (or `do` plus `verify-subagent-diffs-before-integration`). Use one isolated `.omc/wt-*` worktree and one reviewable PR per independent row below. Open upstream PRs remain watch-only until merged.

**Goal:** Replace the login text heading with the supplied DurinDoor wordmark, show the built-in password hint only while that literal password is active, and port every verified merged 9router/OmniRoute gap from the 2026-08-14 audit without regressing DurinDoor-specific behavior.

**Architecture:** Treat the login change as a small authenticated-status contract plus a presentation consumer. Treat every upstream change as behavior to adapt—not a patch to apply blindly—against DurinDoor's JavaScript runtime, provider registry, OpenAI bridge, dashboard, and security boundaries. Land dependency chains serially; run independent rows in parallel worktrees; review every diff before integration.

**Tech stack:** Next.js 16, React, JavaScript, Vitest, SQLite/Drizzle repositories, `open-sse`, provider registry modules, dashboard API routes.

---

## 1. Audited source baseline and hard rules

- Fork baseline: `bloodf/durindoor@1c14989f8ec6a56cce1df1bb2806e8ba885012f7` (`origin/main`).
- 9router audited head: `decolua/9router@699edac3273e13d4744bc46f6082618f08560702`.
- OmniRoute audited head: `diegosouzapw/OmniRoute@abd4df63dc25479853d0b7410f59d4c1b5816ccc`.
- Audited inputs: latest 50 eligible 9router PRs, latest 30 eligible OmniRoute PRs, 31 new first-parent 9router commits, and 121 new first-parent OmniRoute commits: 232 rows total.
- Final dispositions: **48 merged/canonical ports**, **32 open-PR watches**, **34 duplicates**, **117 not applicable**, and **1 defer**.
- Complete evidence ledger: [`docs/campaigns/upstream-omniroute-2026-08-14-audit.md`](../../campaigns/upstream-omniroute-2026-08-14-audit.md).

### Non-negotiable execution rules

1. Never port an open PR. Re-evaluate it after merge using its final merge commit; then move it from WATCH to PORT/DUPLICATE/N-A.
2. Preserve DurinDoor-only provider transports, dashboard behavior, MCP support, wire compatibility, and `~/.9router` compatibility.
3. Do not copy TypeScript-only changes into this JavaScript fork unless they change observable runtime behavior.
4. Each code/behavior PR must include a focused unit or integration test and the smallest fitting docs/CHANGELOG update. Never grow `tests/__baseline__/known-fails.txt`.
5. Before editing an exported symbol, run LSP references and migrate every caller in the same PR.
6. For translator tests that call `translateRequest`/`translateResponse`, import `tests/translator/registerAll.js` and use `--config tests/vitest.config.js`.
7. Before push: focused test, full `cd tests && npm run test:ci`, `npm run lint`, `npm run build`, `npx commitlint --from=origin/main --to=HEAD`, and a load-bearing negative-control check for each new test.
8. PR body must record scope, source commit/PR, fork adaptation, tests, docs, baseline impact, and wire/migration concerns.

---

## 2. Standard row execution recipe

Apply these steps to every `P-*` port row below:

1. Create `.omc/wt-<short-name>` from the latest `origin/main`; never reuse a worktree across PRs.
2. Read the exact upstream commit/merged PR diff and the ledger's fork evidence. Confirm the gap still exists after prior campaign PRs.
3. Write a focused failing test for the stated observable behavior. Run it and capture the red result.
4. Port the smallest fork-native behavior. Reuse existing config/schema/registry seams; do not create a second convention.
5. Run the focused test, then mutate or temporarily remove the production fix and confirm the test fails for the plausible regression. Restore the fix and rerun green.
6. Update `CHANGELOG.md` plus the narrowest relevant doc/JSDoc.
7. Request independent review, resolve findings, run the full gate once, validate commit/PR titles, and open the PR against `main`.
8. Merge dependency chains in order; rebase each dependent worktree on the newly landed `main` and rerun its focused test.

---

## 3. Login design and authentication safety

### Task L-01: Block remote sessions while the built-in password is active

**Source:** OmniRoute `8a527fec9139` (only the two confirmed gaps; its search SSRF sub-change is already duplicated by DurinDoor's outbound URL guard).

**Files:**
- Modify: `src/app/api/auth/login/route.js`
- Modify: `src/app/api/usage/request-details/route.js`
- Test: `tests/unit/auth-login-default-password.test.js`
- Test: `tests/unit/usage-request-details-redaction.test.js`
- Document: `CHANGELOG.md`, `docs/operations/security.md`

**Steps:**
1. Add a failing login-route test proving `mustChangePassword: true` returns HTTP 403 and does **not** issue `auth_token`.
2. Add a failing request-details test proving request/provider-request/provider-response/response payload bodies are redacted for dashboard consumers.
3. Put the default-password rejection before `setDashboardAuthCookie` and preserve the existing password-change response contract.
4. Redact only sensitive payload fields; preserve IDs, timestamps, status, usage, latency, and diagnostics needed by the UI.
5. Run both focused tests and browser-smoke the existing forced-password-change flow.

### Task L-02: Report whether the literal built-in password is active

**Files:**
- Modify: `src/app/api/auth/status/route.js`
- Modify: `tests/unit/auth-status.test.js`
- Document: inline route contract and `CHANGELOG.md`

**Steps:**
1. Add a failing status-route test for `usingDefaultPassword` in four cases: no stored hash/default env; stored default hash; stored custom hash; dependency failure.
2. Compute the flag from the same precedence used by `verifyDashboardPassword`: `settings.password || process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD`.
3. Return `usingDefaultPassword` only when password auth is active and the effective hash equals the built-in default hash. Never infer it from a missing row alone.
4. Keep the status route closed on dependency errors (`authenticated:false`, `requireLogin:true`) and never return a password or hash.
5. Run `tests/unit/auth-status.test.js`.

### Task L-03: Replace the login text heading with the supplied wordmark

**Files:**
- Source asset: `assets/durindoor-wordmark.png`
- Add generated static asset: `public/durindoor-wordmark.png`
- Modify: `src/app/login/page.js`
- Verify: `scripts/verify-static-assets.mjs`, browser smoke at `/login`
- Document: `CHANGELOG.md`

**Steps:**
1. Crop only the asset's empty/black outer canvas (the supplied file's visible mark is centered within a 1560×440 canvas); do not redraw or substitute the logo. Preserve aspect ratio and write the cropped asset under `public/`.
2. Replace the text `DurinDoor` heading and diamond glyph with Next `Image`, `alt="DurinDoor"`, intrinsic dimensions, eager loading, `w-72 max-w-full`, and centered layout.
3. Preserve the subtitle, password/OIDC forms, dark background, and existing responsive width. Remove no unrelated branding.
4. Render `Default password is 123456` beneath the password input only when status reports `usingDefaultPassword === true`; hide it for OIDC, custom passwords, reset/change forms, loading, and status failures.
5. Run the static-asset verifier and a production browser smoke at desktop and narrow mobile widths. Confirm the mark is crisp, centered, unclipped, and that the hint disappears after changing the password.

**Dependency:** Land `L-01` before `L-02`/`L-03`, so displaying the default-password hint cannot create a remotely authenticated default-password session.

---

## 4. Port wave A — security, auth, and high-risk routing

Each row is an independent PR unless a dependency is stated.

| ID | Upstream source | Fork change | Focused test target | Dependency |
| --- | --- | --- | --- | --- |
| P-A01 | `92259214db7` | Add `src/lib/auth/trustedPeer.js`; stamp a process peer token in `custom-server.js`; require proof before trusting `x-9r-real-ip` in `dashboardGuard.js` and `loginLimiter.js`; cover IPv6 loopback. | `tests/unit/trusted-peer-headers.test.js`, `tests/unit/login-limiter.test.js` | First security PR |
| P-A02 | `8a527fec9139` | Implement the two confirmed gaps described by `L-01`; do not duplicate the existing SSRF guard. | Login/default-password and request-redaction tests | After P-A01 |
| P-A03 | `8417ace4b37` | Port Codex OAuth fingerprint modes and identity convergence using DurinDoor's JS config/executor/UI seams. | `tests/unit/codex-identity.test.js`, executor request test | None |
| P-A04 | `9da4e24013d` | Normalize executor result contracts before `chatCore` consumes them; reject invalid shapes deterministically. | `tests/unit/executor-result-contract.test.js` | Before P-A06 |
| P-A06 | `c928224` | Restore provider breaker status guard so stale/mismatched status cannot poison another provider/model. | `tests/unit/provider-breaker-status.test.js` | After P-A04 |
| P-A08 | `ae54c6221c2e` | Allocate Responses API `output_index` after reasoning/message items so a following tool call cannot collide. | `tests/translator/responses-output-index.test.js` | None |
| P-A09 | `d085a0e6939b` | Add xAI OAuth Responses request conversion and the missing breaker import; preserve non-OAuth xAI transport. | `tests/unit/xai-oauth-responses.test.js` | None |
| P-A10 | `20ea78c9432f` | Add provider-scoped error-rule/status restatement and map AgentRouter quota-shaped 400/403 responses to retryable 429. | `tests/unit/upstream-status-restatement.test.js` | P-A04 recommended |
| P-A11 | `4eac410c944` | Mark synthetic no-auth credentials structurally (`authType:'none'`) and narrow combo preflight without connection-ID sentinels. | `tests/unit/noauth-combo-preflight.test.js` | None |
| P-A12 | `e1115e283952` | Route `opencode-go` by request format using provider transports and per-model supported formats. | `tests/unit/opencode-go-models.test.js` | None |
| P-A13 | `e9020f0` | Enforce OpenAI model lifecycle without silently rerouting shutdown models; add HTTP 410/model-shutdown handling and provider-aware family fallback. | `tests/unit/model-lifecycle.test.js` | Reconcile existing alias behavior before removal |

**Wave A gate:** run all focused tests together, then the full Vitest gate. Do not begin dependent runtime work until P-A04/P-A06 are merged.

---

## 5. Port wave B — runtime, combo, and executor correctness

| ID | Upstream source | Fork change | Focused test target | Dependency |
| --- | --- | --- | --- | --- |
| P-B01 | `27e163e2c966` | Guard non-streaming `JSON.parse` results with `isJsonRecord` before envelope unwrap/access. | `tests/unit/nonstreaming-json-contract.test.js` | P-A04 recommended |
| P-B02 | `7e5f5a8813ef` | Re-anchor Claude passthrough cache breakpoints and retain the 1h TTL behavior. | `tests/unit/claude-cache-control.test.js` | None |
| P-B03 | `05b13118848` | Extract Perplexity Web answer text from `workflow_block` in addition to existing block types. | `tests/unit/perplexity-workflow-block.test.js` | None |
| P-B04 | `345cdcf6a5d2` | Detect Hermes/Vercel attachment image shapes and strip unsupported modalities consistently. | `tests/unit/combo-capability-detection.test.js` | None |
| P-B05 | `80afb59907ae` | Peek Qoder stream start for billing blocks and return 403 so combo fallback can act. | `tests/unit/qoder-billing-fallback.test.js` | None |
| P-B07 | `de32d5ae5811` | Resolve combo names case-insensitively before Codex/model rewrite. | `tests/unit/combo-case-insensitive.test.js` | None |
| P-B08 | `fffeb14e4058` | Recover Kimi temporary limits without permanently blocking the account. | `tests/unit/kimi-temporary-limit.test.js` | None |
| P-B09 | `4bda22583eab` | Repair provider-response summaries while preserving dashboard diagnostic fields and error classes. | `tests/unit/provider-response-summary.test.js` | P-A04 |

---

## 6. Port wave C — translator and model semantics

| ID | Upstream source | Fork change | Focused test target | Dependency |
| --- | --- | --- | --- | --- |
| P-C01 | `6143da70d13` | Persist standalone Gemini `thoughtSignature` and reattach it to the following tool call on the direct Claude↔Gemini path. | `tests/translator/gemini-thought-signature.test.js` | Direct-route registry must be active |
| P-C02 | `2355f7beb3b9` | Resolve Claude thinking/output caps with the routed provider and configured per-provider max output. | `tests/unit/custom-max-output-ceiling.test.js` | None |
| P-C03 | `99d19f8f` | Flatten root-level `anyOf` tool schemas only for Kimi/Moonshot OpenAI-shaped transports. | `tests/translator/kimi-root-anyof.test.js` | None |
| P-C04 | `0a72988bde20` | Make an explicit function-tool declaration win over the `apply_patch` custom-tool fallback. | `tests/translator/responses-apply-patch-precedence.test.js` | P-A08 |
| P-C05 | `f2d94957c829` | Map Ollama Cloud `xhigh` reasoning effort to the maximum supported level without changing unrelated providers. | `tests/translator/ollama-cloud-thinking.test.js` | None |
| P-C06 | `f0dc77892a3a` | Allow DeepSeek V4 to reach its native maximum reasoning tier. | `tests/translator/deepseek-v4-thinking.test.js` | None |
| P-C07 | `2eec31b84a05` | Align Responses stream-option handling and prevent incompatible options from crossing transport boundaries. | `tests/translator/responses-stream-options.test.js` | None |
| P-C08 | `6d30ce6de562` | Strip `stream_options` for Fusion/Claude-shaped requests and retain the reasoning probe behavior. | `tests/translator/fusion-stream-options.test.js` | None |
| P-C09 | `86694ed8d048` | Add Gemini 3.7 Flash Antigravity models, capabilities, pricing, aliases, and usage metadata. | `tests/unit/antigravity-model-catalog.test.js` | Verify vendor availability before merge |
| P-C10 | `8ed9da7165340` | Add GLM-5.3 to GLM Coding and GLM China registries. | `tests/unit/glm-model-catalog.test.js` | Re-evaluate WATCH `#10358` afterward |
| P-C11 | `2f264d96dc33` | Expose an OpenAI Responses `store` toggle for eligible non-Codex connections without leaking internal markers. | `tests/unit/openai-responses-store-setting.test.js` | None |

---

## 7. Port wave D — providers, media, CLI, compression, and dashboard

| ID | Upstream source | Fork change | Focused test target | Dependency |
| --- | --- | --- | --- | --- |
| P-D01 | `b04c03c6b51` | Add Alibaba Token Plan international registry entry and regenerate the registry index/baselines. | `tests/unit/alibaba-token-plan-provider.test.js` | Run registry generator, never hand-edit index |
| P-D02 | `8af5e752da4d` | Add Fish Audio TTS registry and adapter format wiring. | `tests/unit/fish-audio-tts.test.js` | None |
| P-D03 | `10400` | Derive `imageToText` from OCR registry metadata and seed Chutes OCR capability. | `tests/unit/provider-service-kinds.test.js` | None |
| P-D04 | `b57c041345b2` | Add LLM7 dashboard connection-test support using its registry validation URL and bearer auth. | `tests/unit/provider-test-llm7.test.js` | None |
| P-D05 | `8718d2b62f7e` | Change Kilo Gateway auth type from required API key to optional, preserving existing keys. | `tests/unit/kilo-gateway-auth.test.js` | None |
| P-D06 | `8101c879e89` | Validate and persist compatible-provider data URL icons safely. | `tests/unit/provider-data-url-icon.test.js` | Retain URL/size bounds |
| P-D07 | `f1673f6bb718` | Normalize images to a 2048px long edge before vision describe self-calls. | `tests/unit/vision-bridge-image-normalize.test.js` | Before P-D08 |
| P-D08 | `a7ddcf16ba0c` | Add configurable vision describe output cap; retain DurinDoor's already-present native-vision skip guard. | `tests/unit/vision-bridge.test.js` | P-D07 |
| P-D09 | `587e53a3c1f` | Cap `countTextTokens` work at 50k characters and strip base64 data URIs before estimation. | `tests/unit/compression-token-estimate.test.js` | None |
| P-D10 | `71dcdc105306` | Let the Headroom toggle reflect the saved enabled setting even while the proxy is down. | `tests/unit/token-saver-headroom-setting.test.js` | None |
| P-D11 | `ed48328c7ce` | Parse and edit OpenCode JSONC without destroying comments; honor XDG and `.jsonc` precedence. | `tests/unit/opencode-settings-jsonc.test.js` | Add only the source-verified JSONC dependency |
| P-D12 | `ce4abd7ef4b8` | Force the official OpenCode CLI User-Agent when CLI identity synthesis is enabled. | `tests/unit/opencode-client-headers.test.js` | Before P-D13 |
| P-D13 | `67271d859eee` | Send official OpenCode client headers on free-tier requests while filtering untrusted client IPs. | `tests/unit/opencode-client-headers.test.js` | P-D12 and P-A01 |
| P-D14 | `5b417f9bf28a` | Detect Kiro chat by `x-amz-target`, prepend Smithy initial-response frame, update MITM domain, and map the `auto` slot. | `tests/unit/kiro-mitm-chat-detection.test.js` | None |
| P-D15 | `e2a4fe048fe0` | Add `api_key` to the Hermes model block using the existing environment/config contract. | `tests/unit/hermes-model-config.test.js` | None |
| P-D16/17 | `456f2a2635a3` + `cd4003bc8bf4` | In one atomic quota-refresh PR, wire `force` from UI to service, add cache bypass, fix stale-after-TTL behavior, and lengthen polling without hiding hard failures. | `tests/unit/usage-force-refresh.test.js`, `tests/unit/claude-usage-cache.test.js` | Circular cross-layer contract; port together |
| P-D18 | `abd4df63dc25` | Surface Qwen/Alibaba personal Token Plan quota in preflight and dashboard usage. | `tests/unit/qwen-token-plan-usage.test.js` | None |

---

## 8. Open-PR watch queue — do not implement before merge

At each campaign checkpoint, query the PR state and compare the final merge commit against the current fork. A merged item becomes a new isolated port row; a closed-unmerged item becomes N-A; a superseded item links to its replacement.

### 9router WATCH

- `#3326` Headroom dashboard asset-path rewriting through the proxy.
- `#3325` adaptive unsupported-parameter stripper.
- `#3321` OpenCode versioned UA and proven real client IP for Zen free models.
- `#3320` Antigravity IDE fingerprint 2.5.5.
- `#3319` reserve thinking effort for Response targets only (currently DEFER within the PR until final behavior stabilizes).
- `#3318` wrap array tool outputs for Gemini/Antigravity `functionResponse`.
- `#3317` OpenClaude CLI-tool support.
- `#3316` log the effective Codex service tier.
- `#3315` retry the Codex fake HTTP-200 overload message.
- `#3313` SSRF guard for provider-node testing.
- `#3310` Xiaomi Token Plan tool-call argument/capability fixes.
- `#3297` forward usage on streamed `response.completed`.
- `#3295` Ollama Local diagnostics and timeout/retry tuning.
- `#3277` combo fallback on HTTP-200 errors plus Responses ordering.
- `#3276` Cursor AgentService HTTP/2 proxy tunneling.
- `#3273` live Usage Sessions and CLI custom URL presets.
- `#3272` Oh My Pi CLI integration.
- `#3268` Codex fast service tier for image generation.
- `#3265` CommandCode per-connection ZDR toggle.
- `#3258` MiniMax text-to-video generation.
- `#3255` provider-selection latency monitoring.
- `#3252` custom-provider catalogs suppress unnecessary live fetches.
- `#3250` OpenCode Go plan usage and spent-key classification.
- `#3243` nest reasoning effort for OpenAI Responses targets.
- `#3214` Antigravity/Gemini streaming and 3.6 hardening.
- `#3221` key chat error state by model and preserve the upstream status class.
- `#3211` Novita AI provider support.

### OmniRoute WATCH

- `#10409` team billing cost centers and shared budgets.
- `#10392` lowercase-to-PascalCase Claude tool-name normalization.
- `#10376` Gemini/Claude reasoning-capability unblock.
- `#10366` provider connection `PATCH` delegation for CLI rotate.
- `#10363` OpenRouter reference-image edits.
- `#10358` GLM-5.3 models plus effort tiers (subtract merged commit `8ed9da7165340` before porting).

### Watch reconciliation tests

For every promoted WATCH row:
1. Re-read the final merged diff, not the old open-PR head.
2. Re-run fork gap verification and update the audit ledger verdict/evidence.
3. Identify overlaps with already-landed P-rows and port only the residual behavior.
4. Add the promoted task to this plan with exact files, test, dependency, and risk before implementation.

---

## 9. Campaign integration order

1. **Security baseline:** P-A01 → P-A02 → L-02/L-03.
2. **Executor contract chain:** P-A04 → P-A06 → P-B01/P-B09/P-A10.
3. **OpenCode chain:** P-D12 → P-D13; land P-A01 before forwarding client IP.
4. **Usage cache chain:** port P-D16/17 atomically because the force wire and cache bypass consume each other.
5. **Vision bridge chain:** P-D07 → P-D08; P-D09 may run independently.
6. **Combo fallback:** P-B05 is independent; DurinDoor has no LKGP strategy to port.
7. All other independent rows may be implemented in parallel batches of no more than eight worktrees, followed by one combined-tree gate before opening the next batch.
8. Re-evaluate the 32 WATCH rows and the one DEFER row after every upstream sync and before the final release cut.

---

## 10. Final combined-tree verification and release handoff

After every P-row and L-row is merged into the campaign integration branch:

1. Confirm `docs/campaigns/upstream-omniroute-2026-08-14-audit.md` has no unresolved PORT row and every WATCH row still names a concrete trigger.
2. Run `npm run check:registry-index` and regenerate only if provider registry rows changed.
3. Run `npm run lint`.
4. Run `cd tests && npm run test:ci`; compare `tests/__baseline__/known-fails.txt` byte-for-byte with `origin/main` and reject any growth.
5. Run `npm run build`.
6. Run the production smoke matrix:
   - login with built-in password from a local request: forced change flow, no pre-change authenticated cookie;
   - login with a custom password: no default hint;
   - OIDC login: no password hint;
   - one request per affected transport family (OpenAI, Responses, Claude, Gemini/Antigravity, Kiro, OpenCode, Codex, combo);
   - one provider catalog and provider-test request;
   - usage cache forced and non-forced refresh paths.
7. Run `npx commitlint --from=origin/main --to=HEAD` and validate the final PR title through commitlint.
8. Request an independent combined-tree review for security boundaries, translator direct routes, retry loops, and provider/catalog drift.
9. Open the integration PR against `main` only after all focused PRs are green, review threads are resolved, documentation is current, and the complete diff has been presented to the maintainer.
