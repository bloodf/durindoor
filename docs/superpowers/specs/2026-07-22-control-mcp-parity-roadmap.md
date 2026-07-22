# DurinDoor Control API, MCP, Testing & Parity — Roadmap

**Status:** Approved design (roadmap). Each workstream below gets its own spec → plan → implementation → release cycle.
**Date:** 2026-07-22
**Baseline:** DurinDoor v2.2.9 (`origin/main` @ `d6285f908`).

## 1. Context

The request bundles five independent asks:

1. Add more API routes to control DurinDoor.
2. Improve the MCP (Model Context Protocol) implementation.
3. Add MCP-gateway information to the MCP Help page.
4. Cover more parts with unit testing.
5. Reach "100% parity" with OpenAI and Anthropic API calls.

These are five separate subsystems, not one project. This document is the umbrella roadmap: it decomposes the work, fixes the load-bearing architecture decisions, sequences the workstreams, and defines a done-state for each. Each workstream ships as its own versioned release, following the established fix → PR → CI-green → squash-merge → tag → deploy flow.

### 1.1 Grounding — what exists today (from a codebase audit)

- **Control surface (implicit).** REST CRUD already exists for providers, API keys, combos, tunnels, MCP instances, and settings, all behind `src/dashboardGuard.js` (session JWT / CLI machine-token / API key / local-only). There is no documented "admin API" and no OpenAPI spec.
- **MCP — two surfaces.**
  - **Gateway** (`src/lib/mcp/gateway/`, `src/app/api/mcp-gateway/*`): proxies/aggregates registered upstream MCP servers to external clients over streamable-HTTP (`/api/mcp-gateway/message`) and SSE, with a stdio bridge for allowlisted local plugins. Full OAuth (discovery, DCR, CIMD, refresh/rotation). Auth via `mcpGatewayKeys` with per-key instance + tool grants; tools namespaced `slug__toolName`.
  - **Control server** (`src/app/api/mcp/control/route.js`, `src/lib/mcp/control/tools.js`): a JSON-RPC MCP server exposing **7 management tools** (`list_providers`, `list_connections`, `toggle_connection_active`, `toggle_provider_active`, `usage_stats`, `token_saver_stats`, `model_list`), auth via `dashboardGuard`.
- **MCP Help page** (`src/app/(dashboard)/dashboard/mcp-help/page.js`): a 3-bullet stub. Missing the tool-naming convention, instance/grant model, the control tools, OAuth flow, transports, and troubleshooting.
- **Tests:** ~209 suites / ~674 tests. Strong on translators, quota, combos, RTK. Nine subsystems have **zero** direct unit tests, notably `chatCore.js` (~1,219 lines — the whole request lifecycle). Baseline `tests/__baseline__/known-fails.txt` is empty (rule: never grow it).
- **Parity:** a hub-and-spoke translator (`open-sse/translator/`, `source → openai → target`). Known lossy points are already enumerated as `it.fails` bug-exposure tests in `tests/translator/bugs-*.test.js` (thinking blocks, image URLs, `input_audio`, `tool_result.is_error`, tool ids, `tool_choice:none`, non-text system blocks, cache_control, …).

## 2. Approved decisions

| Decision | Choice |
| --- | --- |
| Control surface shape | **Both** MCP tools and REST, over **one shared control service layer**. |
| Service layer location | `open-sse/services/control/`. |
| REST namespace | **Extend existing `/api/*`** (no new `/api/admin` namespace). |
| Parity target | **Field-level compatibility matrix** for chat/completions + messages, driven to green. Other endpoints are out of scope for this roadmap. |
| Test coverage scope | **Top ~10** highest-value untested subsystems. |
| Sequencing | **Quick wins first, then big builds.** Each workstream is its own release. |

## 3. Workstreams & sequence

```
WS1 MCP Help page (docs)  ──►  WS2 Test coverage (top-10)  ──►  WS3 Control service layer (MCP tools + REST)  ──►  WS4 Parity matrix (chat/completions + messages)  ──►  WS5 MCP gateway polish
```

| WS | Deliverable | Target release |
| --- | --- | --- |
| 1 | MCP Help page rewrite | v2.3.0 |
| 2 | Unit tests for the top-10 untested subsystems | v2.3.1 |
| 3 | `control` service layer → refactor the 7 MCP tools onto it, add gap tools, add REST routes, publish OpenAPI | v2.4.0 |
| 4 | Field-level parity matrix + fix the `it.fails` gaps for the two core endpoints | v2.5.0 |
| 5 | MCP gateway improvements (instance pause/restart/reprobe, health, retry/backoff polish) | v2.5.1 |

Rationale for the order: WS1 is zero-risk docs and ships immediately for momentum; WS2 lays a safety net before WS3/WS4 touch load-bearing internals; WS3 builds the shared layer that WS5 then polishes; WS4 (the largest) benefits from the test patterns established in WS2/WS3.

---

## WS1 — MCP Help page rewrite (v2.3.0)

**Goal:** turn the stub into real documentation of DurinDoor's MCP surfaces.

**Scope:** rewrite `src/app/(dashboard)/dashboard/mcp-help/page.js` (static server component, themed like the other dashboard help pages) to cover:

- Gateway vs. control server — what each is for.
- Transports: streamable-HTTP (`POST /api/mcp-gateway/message`), SSE handshake (`/api/mcp-gateway/sse`), the stdio bridge for allowlisted local plugins.
- Tool namespacing (`slug__toolName`) and the instance + grant model (`mcpInstances`, `mcpGatewayKeys`, `mcpKeyGrants` with `toolAllowlist`).
- The control tools list and how to call `/api/mcp/control`.
- OAuth flow for upstream MCP servers (discovery → DCR/CIMD → login → refresh), and how to reconnect.
- Gateway-key creation, bearer-token auth, and a concrete client-config example.
- Troubleshooting (401s, needs-reauth, SSRF-blocked URLs, stdio spawn failures).

**Done-state:** the page documents every surface above; a lightweight render/content test asserts the key sections are present. No behavior change.

**Non-goals:** any code change to the gateway itself (that is WS5).

---

## WS2 — Unit test coverage, top-10 gaps (v2.3.1)

**Goal:** eliminate the highest-value blind spots. One focused `tests/unit/*.test.js` per target; no growth of `known-fails.txt`; deterministic and full-suite-safe.

Ranked targets (impact × testability):

1. `open-sse/handlers/chatCore.js` — request lifecycle: format detection, passthrough, translation dispatch, quota reservation, streaming vs non-streaming routing, compression seam, credential refresh. (`chatcore-request-lifecycle.test.js`)
2. `src/lib/auth/dashboardSession.js` + login limiter — session JWT + rate limiting (security-critical). (`dashboard-auth.test.js`)
3. `src/lib/mcp/gateway/` — `handler.js`, `aggregator.js`, `grants.js`, retry. (`mcp-gateway.test.js`)
4. `src/lib/tunnel/{tailscale,cloudflare}/manager.js` — enable/disable/status, URL resolution. (`tunnel-manager.test.js`)
5. `open-sse/services/oauthCredentialManager.js` — serialized refresh, `reauth_required`, concurrent-winner reconciliation. (`oauth-credential-manager.test.js`)
6. `src/lib/db/repos/connectionsRepo.js` — atomic merge + compare-and-swap `refreshToken` retention. (`connections-repo-reauth.test.js`)
7. `src/lib/db/helpers/apiKeyPolicy.js` + `apiKeysRepo.js` — policy enforcement, expiry. (`api-key-policy.test.js`)
8. `open-sse/transformer/responsesTransformer.js` — Chat Completions SSE ↔ Responses API SSE structural test. (`responses-transformer.test.js`)
9. `src/lib/crypto/columnCrypto.js` — encrypt/decrypt roundtrip, null handling, key derivation. (`column-crypto.test.js`)
10. `src/lib/network/{connectionProxy,proxyTest,outboundProxy}.js` — proxy selection + SSRF guards. (`network-proxy.test.js`)

**Overlap bonus:** targets 3, 5, 6 also underpin WS3, so this work partly pre-pays WS3's test cost.

**Done-state:** all ten suites green; each defends an observable contract and would fail on a plausible bug.

---

## WS3 — Shared control service layer + MCP tools + REST (v2.4.0)

**Goal:** one control service layer, exposed as both MCP tools and REST routes, with no duplicated business logic.

**Architecture:**

```
MCP clients ─► /api/mcp/control tools ─┐
scripts/curl ─► /api/* REST handlers  ─┼─► open-sse/services/control/*  ─► existing repos + managers
dashboard UI ─► /api/* REST handlers  ─┘
```

- **`open-sse/services/control/`** — one module per domain: `providers.js`, `keys.js`, `combos.js`, `mcp.js`, `tunnels.js`, `settings.js`, `system.js`. Each exports async functions that orchestrate the existing repos/managers (`connectionsRepo`, `apiKeysRepo`, combos, settings, MCP instances, tunnel managers). Business logic lives **only** here.
- **MCP adapter:** refactor the existing 7 `src/lib/mcp/control/tools.js` tools to call the service layer, then add the gap tools.
- **REST adapter:** add routes/methods under the existing `/api/*` groups (no new namespace), each handler = validate → call service → shape response.
- **Auth:** unchanged — `dashboardGuard` (session/CLI/API-key/local-only). No new auth model.
- **OpenAPI:** publish a spec describing the control routes (served from a route + committed artifact).

**New capabilities (the audited gaps), exposed both ways:** bulk connection/provider enable-disable; MCP instance pause / restart / reprobe; headroom proxy start/stop; feature-flag toggles (`enableTranslator`, `enableRequestLogs`); provider-node CRUD (incl. DELETE); settings sub-operations (OIDC, outbound proxy) without hand-PATCHing `/api/settings`.

**Testing:** one suite per service module (reuses WS2 patterns) plus adapter-level tests asserting MCP tool ↔ REST route parity (same input → same effect).

**Done-state:** every control operation is reachable via both an MCP tool and a REST route through the shared layer; OpenAPI spec published; service + adapter tests green.

**Non-goals:** no change to LLM inference routes; no new auth model.

---

## WS4 — Field-level parity matrix, chat/completions + messages (v2.5.0)

**Goal:** a green/red, regression-proof compatibility matrix for the two core endpoints.

**Mechanism:**

- **Matrix data files** (e.g. `tests/parity/matrix/openai-chat.js`, `anthropic-messages.js`) enumerate every request and response field of each endpoint, tagged `supported | translated | dropped | n-a`, each with a source citation.
- **A generated test** walks the matrix: `supported`/`translated` fields get a fixture asserting they survive the round-trip through the translator; `dropped` fields carry an `it.fails` marker + citation (consistent with the existing `bugs-*.test.js` convention).
- **Drive to green:** convert `dropped → translated` by fixing the translator for the enumerated lossy points (thinking / redacted_thinking blocks, image URLs, `input_audio`, `tool_result.is_error`, tool id/index stability, `tool_choice:none`, non-text system blocks, `cache_control`, usage fields, finish/stop-reason mapping, streaming SSE event coverage).
- **CI parity report:** print matrix coverage % so any regression is visible in CI.

**Done-state:** the matrix for chat/completions and messages is enumerated and green for all fields we commit to; each remaining `dropped` field is an explicit, cited, tracked gap (not a silent loss). "100%" is scoped to these two endpoints; other endpoints are future work.

**Non-goals:** implementing missing OpenAI/Anthropic *endpoints* (moderations, legacy completions, batches parity, etc.) — tracked separately if desired later.

---

## WS5 — MCP gateway improvements (v2.5.1)

**Goal:** operational polish on the gateway now that the control layer exists.

**Scope (candidates, finalized in WS5's own spec):** instance pause / restart / reprobe as first-class operations (via the WS3 control layer); gateway health surfacing; retry/backoff and session-recovery hardening for HTTP/stdio upstreams; clearer needs-reauth signaling. Each change ships with tests.

**Done-state:** defined in WS5's dedicated spec.

---

## 4. Cross-cutting conventions

- Every workstream: Conventional Commits, `port`/`sync` types where relevant, subject ≤ 100 chars; PR into `main`; CI green (Lint & Build + Vitest no-regression + commitlint) before squash-merge; then tag + GitHub release + deploy to `/opt/cortexos/durindoor-fork`.
- Documentation is required for every change (AGENTS.md §1); unit tests required for behavior changes; never grow `known-fails.txt`.
- Preserve fork-only invariants (MCP gateway/dashboard/branding, API-key wire compat, `~/.9router` DATA_DIR).

## 5. Next step

Proceed workstream-by-workstream. WS1 (MCP Help page) is first: it gets its own spec (if needed — it may be small enough to go straight to a plan) → implementation → v2.3.0 release. Each subsequent workstream repeats the cycle.
