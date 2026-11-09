# Provider Candidate Evaluation & Integration Proposal: Speka AI (Issue #1233)

## 1. Context & Dispatch Authorization

- **Task Authority**: Authorization by Heitor explicitly permitting parallel delivery of authorized new backlog items alongside existing PR integration.
- **Tracking Issue**: [bloodf/durindoor#1233](https://github.com/bloodf/durindoor/issues/1233) — `port(omniroute): evaluate and add speka provider`.
- **Parent Epic**: [bloodf/durindoor#1069](https://github.com/bloodf/durindoor/issues/1069) Epic: API-key and compatible provider ports.
- **Lease Identifier**: `ca33a32d-c847-4ec2-b2d8-1c294eceb735`.
- **Allocation Profile**: Exact Google high allocation.
- **Base Tree Verification**:
  - Expected `origin/main` commit: `044632eb8bc4cd51a65340fb6c87100879969e70`.
  - Actual workspace `HEAD`: `044632eb8bc4cd51a65340fb6c87100879969e70`.
  - Drift: `0` commits; working tree clean prior to change.
- **CodeGraph Status**:
  - `codegraph status` reported: `Not initialized` (version 1.6.2).
  - Per contract instruction: Uninitialized status recorded; narrow queries conducted via bounded `rg` invocations.
- **Scope & Ownership Boundary**:
  - This unit strictly owns:
    1. `open-sse/providers/registry/speka.js` (isolated new provider registry module)
    2. `tests/unit/provider-speka-evidence.test.js` (evidence & containment unit test)
    3. `internal/docs/provider-speka-1233.md` (this delivery documentation)
  - Zero edits made to shared index or generated files (`open-sse/providers/registry/index.js`, `open-sse/AGENT-INDEX.md`, `docs/providers/catalog.mdx`) to preserve disjoint parallel unit workspaces.

---

## 2. Upstream Reference Contract & Audit

- **OmniRoute Release Snapshot**: `release/v3.8.52` pinned at commit `61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`.
- **Upstream PR & Commit**:
  - Upstream PR: `#9584` “feat(providers): integrate wave4 free-tier gateways” (merged `2026-08-12T06:11:23Z`).
  - Commit: `57640277a224f79c620fcdcf838a9bc0b772a39e`.
- **Upstream Registry Entry**:
  - Path: `open-sse/config/providers/registry/speka/index.ts` (blob `04f1f17c7eb59150173d31e3fb56e6d68f3d7793`):
    ```typescript
    export const spekaProvider: RegistryEntry = buildOpenAiCompatibleRegistryEntry({
      id: "speka",
      alias: "speka",
      baseUrl: "https://speka.me/v1/chat/completions",
      modelsUrl: "https://speka.me/v1/models",
      models: [],
      passthroughModels: true,
    });
    ```
- **Helper Definition**:
  - `buildOpenAiCompatibleRegistryEntry` in OmniRoute sets:
    - `format`: `"openai"`
    - `executor`: `"default"`
    - `authType`: `"apikey"`
    - `authHeader`: `"bearer"`
- **Upstream UI / Display Metadata**:
  - Located in `src/shared/constants/providers/apikey/gateways.ts`:
    ```typescript
    speka: {
      id: "speka", serviceKinds: ["llm"], alias: "speka", name: "Speka AI",
      icon: "router", color: "#DB2777", textIcon: "SP",
      passthroughModels: true, website: "https://speka.me", hasFree: true,
      freeNote: "Free plan: $1 monthly usage, 10 RPM, one API key and access to open models and the playground; no card required.",
      apiHint: "Create a Speka API key, then use https://speka.me/v1 as the OpenAI-compatible base URL. Confirm current model availability and overage settings before use.",
    }
    ```
- **Provider Matrix Audit Record**:
  - Recorded in `internal/docs/omniroute-provider-matrix.json` (lines 9304–9330):
    - `id`: `"speka"`
    - `status`: `"missing"`
    - `class`: `"simple-default"`
    - `executor`: `"default"`
    - `format`: `"openai"`
    - `authType`: `"apikey"`
    - `authHeader`: `"bearer"`
    - `importantFields`: `["modelsUrl", "passthroughModels"]`
    - `hasLocalIcon`: `false`, `hasSourceIcon`: `false`

---

## 3. Primary Endpoint, Auth, Capability Facts & Containment Findings

- **Endpoint Contracts**:
  - Base URL: `https://speka.me/v1/chat/completions`
  - Model Catalog URL: `https://speka.me/v1/models`
- **Wire Format & Transport**:
  - Wire Format: Standard OpenAI Chat Completions.
  - Executor: `default` (`open-sse/executors/default.js`), no custom executor or specialized translation hop required.
  - Auth: `authType: "apikey"`, Bearer token in `Authorization: Bearer <key>`.
- **First-Party Documentation & Legitimacy Discovery**:
  - Per maintainer evaluation on Issue #1233 (2026-11-01):
    - The `/v1/models` endpoint responds with HTTP 200 listing `meta/muse-*` models.
    - No first-party pricing documentation, legal entity disclosures, or authoritative Terms of Service are published on `speka.me`.
    - It appears to operate as an unofficial proxy gateway.
  - **Containment Policy**:
    - Upstream `hasFree: true` and `freeNote` claims ("$1 monthly usage, 10 RPM") are **deliberately excluded** from the DurinDoor registry module. Asserting unverified free tiers would risk misleading users regarding quota and reliability.
    - Notice field states: `"The model catalog comes from the live /v1/models endpoint. Confirm current quota, price and terms before use."`
    - Models array remains empty (`models: []`), with discovery delegated to the live authenticated `/v1/models` endpoint via `modelsFetcher: { url: "https://speka.me/v1/models", type: "openai" }`.
    - Zero live provider calls, paid API invocations, or credential testing were conducted (strictly prohibited during source-stage delivery).

---

## 4. Pre-Integration Namespace & Collision Audit

- **Absence in DurinDoor Registry**:
  - Scanned `open-sse/providers/registry/index.js` and all existing `open-sse/providers/registry/*.js`:
    - Zero entries for provider ID `"speka"`.
    - Zero occurrences in `ALIAS_TO_PROVIDER_ID` or `PROVIDER_ID_TO_ALIAS`.
- **Namespace Collision Check**:
  - Neither ID `"speka"` nor alias `"speka"` collides with any existing provider module or alias in DurinDoor.
- **Brand Assets Compliance**:
  - Upstream has no icon files in `public/providers/` for `speka`.
  - Neutral Material Symbol `"route"` with two-letter badge `"SP"` (`textIcon: "SP"`) is configured per `internal/docs/provider-brand-assets.mdx`.
  - No unlicensed or third-party proprietary artwork is added.

---

## 5. Security & Fail-Closed Posture

- **Strict API Key Requirement**:
  - `authType: "apikey"` with Bearer token authentication required on every outbound request.
  - Prohibits `noAuth: true` or `autoComboNoAuth: true`.
  - No default, hardcoded, or anonymous credentials.
- **Egress Boundary**:
  - Base URLs strictly pinned to `https://speka.me/v1/`.

---

## 6. Delivered Artifacts & Parent Integration Plan

### 6.1 Delivered Registry Module
Delivered in `open-sse/providers/registry/speka.js`:
```javascript
export default {
  id: "speka",
  alias: "speka",
  display: {
    name: "Speka AI",
    icon: "route",
    color: "#DB2777",
    textIcon: "SP",
    website: "https://speka.me",
    notice: {
      text: "The model catalog comes from the live /v1/models endpoint. Confirm current quota, price and terms before use.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://speka.me/v1/chat/completions",
    validateUrl: "https://speka.me/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://speka.me/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
```

### 6.2 Delivered Unit & Containment Test
Delivered in `tests/unit/provider-speka-evidence.test.js`:
- Verifies contract compliance with OmniRoute `61e07fb` baseline.
- Validates neutral presentation metadata.
- Validates pre-integration namespace isolation.
- Validates absence of ID/alias collision with existing registry.
- Validates fail-closed security properties.
- Validates transport merging against `resolveProvider` and `PROVIDER_DEFAULTS`.

### 6.3 Shared Registry Index Integration Plan
Per repository contract (`AGENTS.md`), `open-sse/providers/registry/index.js` must **never** be edited by hand.
When independent review approves this provider, the integration owner will run:
```bash
npm run gen:registry-index
npm run gen:agent-index
npm run gen:provider-catalog
```
This will import `speka.js` into the barrel in alphabetical code-point order (at position ~263) and update `open-sse/AGENT-INDEX.md` and `docs/providers/catalog.mdx`.

---

## 7. External Actions Required Prior to Publication

1. **Independent Parent Review**: Verify that the delivered standalone module and evidence test adhere to containment guidelines and provider contracts.
2. **First-Party Account / ToS Verification**: Confirm operator account credentials and Terms of Service validity for `speka.me` before claiming live-validated status.
3. **Execution of Automated Generators**: Run `npm run gen:registry-index`, `npm run gen:agent-index`, and `npm run gen:provider-catalog` in the consolidated integration branch.
4. **Frozen Runner Verification**: Execute full V5 Local CI gate checkpoint with the independently reviewed runner.
5. **Lease Release**: Release lease `ca33a32d-c847-4ec2-b2d8-1c294eceb735` via parent native terminal.
