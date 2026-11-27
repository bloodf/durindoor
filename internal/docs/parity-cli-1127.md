# CLI provider sign-in parity refresh (#2034)

Compared 2026-11-27 against the exact upstream revisions below and the
DurinDoor checkout at `1184034cec8dbe158ae3e69479a06b1bb7a93359`. Scope is
outbound sign-in providers in CLIProxyAPI, EasyCLIProxyAPI's guided provider
setup and bundled core, plus OAuth sign-in providers in OmniRoute
`release/v3.8.55`. Antigravity and web-cookie/session providers are excluded.
Provider claims describe source contracts and offline fixtures; no provider
accounts or endpoints were used.

## Revisions and evidence

| Source | Exact revision | Evidence |
| --- | --- | --- |
| CLIProxyAPI public `main` | [`47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e`](https://github.com/router-for-me/CLIProxyAPI/commit/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e) | [executor registration](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/sdk/cliproxy/service_executors.go), [auth manager](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/cmd/auth_manager.go), [model definitions](https://github.com/router-for-me/CLIProxyAPI/blob/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/registry/model_definitions.go), [executors](https://github.com/router-for-me/CLIProxyAPI/tree/47f18e4d82bd72f7d2b5ecf5ede93e4837a4625e/internal/runtime/executor) |
| EasyCLIProxyAPI public `main` | [`29567ead8164a00724dfdc2087f02a23895636ee`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/29567ead8164a00724dfdc2087f02a23895636ee) | [guided provider setup](https://github.com/router-for-me/EasyCLIProxyAPI/blob/29567ead8164a00724dfdc2087f02a23895636ee/src/pages/EasyModePage.tsx), [core release/runtime selection](https://github.com/router-for-me/EasyCLIProxyAPI/blob/29567ead8164a00724dfdc2087f02a23895636ee/src-tauri/src/core_runtime.rs), [pinned bundled-core version](https://github.com/router-for-me/EasyCLIProxyAPI/blob/29567ead8164a00724dfdc2087f02a23895636ee/core-version.txt) |
| EasyCLIProxyAPI bundled core | `8.1.3`, tag commit [`8cd6817b831f34caa593c76242d2c1f0674bf794`](https://github.com/router-for-me/CLIProxyAPI/commit/8cd6817b831f34caa593c76242d2c1f0674bf794) | `core-version.txt` selects the default bundled release. The app can also install other releases; this is not a ceiling on the selected runtime core. |
| OmniRoute `release/v3.8.55` | [`9671192011beb2d7f83979f40be488c5da8772b9`](https://github.com/cheaper-inference/OmniRoute/commit/9671192011beb2d7f83979f40be488c5da8772b9) | [OAuth provider selector](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/shared/constants/providers/oauth.ts), [provider registry](https://github.com/cheaper-inference/OmniRoute/tree/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry), [OAuth routes](https://github.com/cheaper-inference/OmniRoute/tree/9671192011beb2d7f83979f40be488c5da8772b9/src/app/api/oauth) |

Public refs were resolved with `git ls-remote`; the source trees were checked out
under `.work/parity-cli-1127/`. EasyCLIProxyAPI's lockfile pins its own GUI
crate at `0.3.120`; that is not the CLIProxyAPI core. The core version comes
from `core-version.txt` and is independently tagged above.

Local evidence is from the current checkout: `open-sse/providers/registry/`,
`src/lib/oauth/constants/oauth.js`, `open-sse/services/tokenRefresh/`,
`open-sse/executors/index.js`, `open-sse/handlers/chatCore.js`,
`src/app/api/providers/[id]/models/`, and named offline tests cited below.
Registry membership alone is not treated as proof of OAuth equivalence.

## Reconciliation table

| Provider / state | Upstream delta and contract | DurinDoor evidence and offline coverage | Next unit acceptance / disposition |
| --- | --- | --- | --- |
| Codex — present, catalog delta | CLIProxyAPI registers OAuth/device-code plus configured API-key auth, HTTP/WebSocket execution and a live authenticated model catalog. Easy's guided setup offers OAuth and API-key setup. OmniRoute has OAuth with refresh. | `codex` registry is OAuth; provider model catalog is a static registry list. `tests/unit/codex-identity.test.js`, `tests/unit/port9r-codex-model-catalog-4406.test.js`, `tests/unit/port9r-codex-import-refresh-1711.test.js`, and `tests/unit/port-omniroute-20525-codex-refresh-identity.test.js` cover identity/catalog/refresh contracts offline. | **Implementable gap:** add a closed-mock catalog refresh test and behavior that refreshes the account-scoped list, retains last-known-good entries on failure, and cannot mix accounts. Verify actual endpoint and auth shape from the pinned source during implementation. Do not reintroduce retired `gpt-5.5` as a ChatGPT model solely because it appears in upstream data. |
| Claude — present | CLIProxyAPI browser OAuth and API-key paths use native Claude execution and static model definitions. Easy exposes OAuth/API-key setup. OmniRoute has Claude Code OAuth and its own request/refresh contract. | `claude` OAuth registry and refresh paths; `tests/unit/claude-protocol-parity.test.js`, `tests/unit/port-4265-claude-reset-grants.test.js`, `tests/unit/claude-model-routability.test.js`. | **Proven source/mock parity** for supported OAuth inference and tested wire behaviors. CLIProxyAPI's per-key tool-cloaking mode is not a supported parity target; no identity-cloaking/evasion port. Live account refresh remains unverified. |
| Gemini API, Interactions, Vertex — present | CLIProxyAPI registers Gemini and Interactions API-key executors and Vertex service-account/API-key execution. Easy exposes all three guided API forms. OmniRoute's OAuth list is separate and does not make these API-key contracts OAuth providers. | `gemini`, `gemini-interactions`, `vertex` registry entries and separate executors; `tests/unit/vertex-eu-endpoint.test.js`, `tests/unit/gemini-parameters-json-schema.test.js`, plus Gemini/Interactions route fixtures. | **Proven source/mock parity** for registrations and tested request boundaries. No provider-specific live credential validation. |
| Gemini CLI / AI Studio Build — present by mapped identity | CLIProxyAPI has native AI Studio OAuth and WebSocket relay. Easy guides API setup while runtime is core-owned. DurinDoor's `gemini-cli` is a separate HTTP executor, while optional CLIProxyAPI sidecar delegation covers its relay contract. | `gemini-cli` registry; `tests/unit/aistudio-relay-provider.test.js` covers discovery, JSON/SSE and disconnect after partial output through a closed sidecar fixture. | **Delegated parity covered offline.** Native AI Studio WebSocket interoperability and real account acceptance remain live-only. Do not describe the HTTP executor itself as the WebSocket relay. |
| Kimi — present, split identities | CLIProxyAPI shares an executor/model set across Kimi aliases and supports OAuth device sign-in/API keys. Easy offers Kimi OAuth. OmniRoute has `kimi-coding` OAuth. | `kimi`, `kimi-ai`, `kimi-coding` registrations; `tests/unit/kimi-signin-parity.test.js` and `tests/unit/kimi-usage.test.js`. | **Proven mapped identity coverage**; IDs and regional endpoints intentionally remain separate. Live device authorization remains unverified. |
| xAI / Grok Build — present, mapped | CLIProxyAPI supports xAI OAuth/device flow, API keys, HTTP and WebSocket. Easy exposes OAuth and API-key forms. OmniRoute `xai-oauth` maps to DurinDoor's `xai`; `grok-cli` is a distinct CLI identity. | `xai` and `grok-cli` entries; `tests/unit/xai-oauth-service.test.js`, `tests/unit/executors/xai-executor.test.js`, and `tests/unit/grok-cli-executor.test.js`. | **Proven mapped coverage** for tested paths. Live OAuth refresh and account entitlement are unverified. |
| GitHub Copilot — present | Current CLIProxyAPI executor baseline includes `copilot`; Easy's guided selector does not. OmniRoute distinguishes GitHub and GitHub Enterprise Copilot OAuth identities. | `github-copilot` and `ghe-copilot`; `tests/unit/ghe-copilot-signin-parity.test.js`, `tests/unit/copilot-endpoint-contract-1073.test.js`, and `tests/unit/ghe-copilot-route.test.js`. | **Proven local support.** Do not call Easy's lack of a named guided setup option a missing DurinDoor provider. Live account acceptance is unverified. |
| Devin — delegated/mapped, not same product identity | CLIProxyAPI's `devin` is hosted inference OAuth/token auth. Easy exposes Devin OAuth. OmniRoute separates Devin Desktop and Devin CLI. DurinDoor's `devin` cloud-agent API and `devin-cli` ACP are distinct; sidecar delegation is the matching CLIProxyAPI inference path. | `tests/unit/devin-inference-provider.test.js`, `tests/unit/devin-cli-signin-parity.test.js`, and `tests/unit/aistudio-relay-provider.test.js` cover delegated routing/streaming and CLI behavior with fixtures. | **Delegated parity covered offline.** Keep the three local service kinds separate. Native hosted account authorization remains live-only. |
| Meta Muse — present, mapped | CLIProxyAPI and Easy use `meta` for Muse device OAuth, with optional API-key config. OmniRoute uses `muse-code`. | DurinDoor `muse-code` has device OAuth; `meta` is a separate Meta Llama API identity. `tests/unit/meta-provider-id-collision.test.js` covers disambiguation and routing. | **Proven identity mapping** in source and mock evidence. No live account validation. |
| OpenAI-compatible/custom providers — present, generic | CLIProxyAPI config creates named API-key executor groups; Easy has a generic OpenAI-compatible connection. These are extensible endpoints, not finite vendor sign-in identities. | Provider-node connection lifecycle plus default OpenAI-compatible executor; covered by provider-node and executor mock suites. | **Equivalent configurable surface.** No per-vendor parity claim without a named provider protocol delta. |
| OmniRoute `chatgpt` — present, renamed and guarded | Pinned OmniRoute offers owner-operated OAuth/Responses inference for a ChatGPT plan connection. | Local `chatgpt-plan` is hidden and owner-operated; its provider module explicitly adapts the OmniRoute source. | **Already covered** in source/implementation; enrollment and real account acceptance remain guarded/live-only. |
| OmniRoute `openference` — present | OAuth OpenAI-compatible inference, live models and seeded fallback. | `openference` registry and `tests/unit/openference-provider.test.js`. | **Proven offline contract coverage**; account acceptance remains live-only. |
| OmniRoute `zed-hosted` — present | OAuth-like Zed hosted account login, live per-connection catalog, multi-vendor model routing. | `zed-hosted` registry/executor and `tests/unit/zed-hosted-provider.test.js`, `tests/unit/zed-hosted-quota.test.js`. | **Proven offline contract coverage**; live sign-in and account catalog remain unverified. |
| OmniRoute newer OAuth/session identities — present or excluded | The pin includes Kiro, Amazon Q, GitHub/GHE Copilot, GitLab Duo, Cursor, Zed, Trae, Kilo Code, Cline/ClinePass, CodeBuddy CN/Intl, WorkBuddy, Qoder, Grok CLI, Freebuff, Devin Desktop/CLI, Muse Code, and MegaBrain. | Matching local registry entries exist for these identities; examples with dedicated offline fixtures include `tests/unit/kiro-signin-parity.test.js`, `tests/unit/amazon-q-route.test.js`, `tests/unit/cline-signin-parity.test.js`, `tests/unit/codebuddy-intl-provider.test.js`, `tests/unit/freebuff-provider.test.js`, and `tests/unit/devin-desktop-provider.test.js`. | **No inventory-level missing provider found** among the examined non-web identities. Per-provider tests differ in depth; account-bound live acceptance remains open where not explicitly recorded. |
| OmniRoute `renderhour` — **missing in DurinDoor** | Pinned OAuth selector advertises subscription OAuth or `rh_` API-key access for image, video and speech; implementation is media job submission/polling, not chat inference. Sources: [`oauth.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/src/shared/constants/providers/oauth.ts), [`mediaModels.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/config/providers/registry/renderhour/mediaModels.ts), [`renderhour.ts`](https://github.com/cheaper-inference/OmniRoute/blob/9671192011beb2d7f83979f40be488c5da8772b9/open-sse/handlers/mediaGeneration/renderhour.ts). | No `open-sse/providers/registry/renderhour.js`, executor or provider service found in the tracked local registry. Existing image/video/speech services do not by themselves prove this provider's job/auth contract. | **Implementable next unit:** add the distinct `renderhour` connection with both OAuth and `rh_` key modes, refresh persistence, account-scoped model discovery, image/video/tts dispatch, async job polling/result decoding, and provider-specific auth/quota/error mapping. Acceptance must use a closed HTTP fixture for each mode; cover successful submit→poll→result, 401/403, 429, timeout/poll failure, model isolation across two credentials, and prove it never dispatches through chat. Do not claim parity before those cases pass. |
| CLIProxyAPI Antigravity — excluded | In scope source contains Antigravity auth/executor/catalog, but work order explicitly excludes it. | Existing local provider and tests intentionally not reconsidered in this inventory. | No next unit here. |
| Browser-cookie/session-import providers — excluded | OmniRoute has cookie/session providers in its auth/provider catalog; not part of this sign-in inventory. | DurinDoor web-cookie providers are not counted as missing or present for OAuth parity. | No next unit here. |

## State and acceptance boundaries

- **Proven parity** means local source and offline tests demonstrate the specific
  stated contract. It does not mean a real vendor accepted a login or request.
- **Implementable gap:** `renderhour` is the only absent identity found among
  the examined in-scope source inventories. The acceptance criteria above are
  a bounded next implementation unit.
- **Dead upstream:** no evidence in these pinned trees establishes a removed
  in-scope provider identity. A model retired locally, an Easy guided-menu
  omission, or an extensible plugin/config provider is not a dead provider.
- **Live-only verification:** sign in and refresh still need authorized accounts
  for the providers identified as awaiting account acceptance by open tracker
  #2034. Existing mocks are offline evidence only. No accounts/calls were used.
- **Other lanes:** open issue [#2642](https://github.com/bloodf/durindoor/issues/2642)
  is a separate TrustedRouter API-key task owned by the review lane and was not
  included as a sign-in gap. Open architecture issues reviewed did not assign a
  CLI provider claim to this work order.
- The repository CodeGraph wrapper reported its required 1.6.2 executable
  unavailable. Per `internal/docs/ai-tooling.md`, bounded `rg` searches were
  used as fallback; this is retrieval assistance, not runtime proof.

## Scoped evidence

No provider tests were run because this is documentation-only work. The required
documentation gate is `pnpm run check:docs`; its result is recorded with the
commit for this report.
