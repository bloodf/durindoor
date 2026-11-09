# Provider Candidate Evaluation & Integration Proposal: ZeroLimit AI (Issue #1253)

## 1. Context & Dispatch Authorization

- **Task Authority**: Authorization by Heitor explicitly permitting parallel delivery of authorized new backlog items alongside existing PR integration.
- **Tracking Issue**: [bloodf/durindoor#1253](https://github.com/bloodf/durindoor/issues/1253) — `port(omniroute): evaluate and add zerolimitai provider`.
- **Lease Identifier**: `216cc59b-2972-4541-aa6e-e5da62653d5c`.
- **Allocation Profile**: Exact Google high allocation.
- **Base Tree Verification**:
  - Expected `origin/main` commit: `044632eb8bc4cd51a65340fb6c87100879969e70`.
  - Actual workspace `HEAD`: `044632eb8bc4cd51a65340fb6c87100879969e70`.
  - Drift: `0` commits; working tree clean prior to change.
- **CodeGraph Status**:
  - `sh scripts/codegraph.sh status --json` reported:
    `{"initialized":false,"version":"1.6.2","projectPath":"...","indexPath":".../.codegraph","lastIndexed":null}`.
  - Per instruction: Uninitialized status recorded; narrow queries replaced with bounded `rg` invocations.
- **Scope & Ownership**:
  - Unit owns exclusively:
    1. `open-sse/providers/registry/zerolimitai.js` (isolated new provider module)
    2. `tests/unit/provider-zerolimitai-evidence.test.js` (evidence & containment unit test)
    3. `internal/docs/provider-zerolimitai-1253.md` (this report)
  - Zero edits made to shared files (`open-sse/providers/registry/index.js`, `open-sse/AGENT-INDEX.md`).

---

## 2. Upstream Reference Contract & Audit

- **OmniRoute Release Snapshot**: `release/v3.8.52` pinned at commit `61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`.
- **Upstream Registry Entry**:
  - Path: `open-sse/config/providers/registry/zerolimitai/index.ts`
  - Implementation:
    ```typescript
    import type { RegistryEntry } from "../../shared.ts";
    import { buildOpenAiCompatibleRegistryEntry } from "../../shared.ts";

    export const zerolimitaiProvider: RegistryEntry = buildOpenAiCompatibleRegistryEntry({
      id: "zerolimitai",
      alias: "zerolimitai",
      baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
      modelsUrl: "https://www.zerolimitai.com/api/v1/models",
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
- **Provider Matrix Audit Record**:
  - Recorded in `internal/docs/omniroute-provider-matrix.json` (lines 10929–10955):
    - `id`: `"zerolimitai"`
    - `status`: `"missing"`
    - `class`: `"simple-default"`
    - `executor`: `"default"`
    - `format`: `"openai"`
    - `authType`: `"apikey"`
    - `authHeader`: `"bearer"`
    - `importantFields`: `["modelsUrl", "passthroughModels"]`

---

## 3. Provider Legitimacy & Network Probe

- **Service Operator**: ZeroLimit AI operates an OpenAI-compatible model routing and inference gateway (`www.zerolimitai.com`).
- **Live Endpoint Verification**:
  - Probe 1: `GET https://www.zerolimitai.com/api/v1/models`
    - Response: `HTTP/2 401 Unauthorized`
    - Headers: `content-type: application/json`, `x-matched-path: /api/v1/models`, `server: Vercel`.
  - Probe 2: `POST https://www.zerolimitai.com/api/v1/chat/completions`
    - Response: `HTTP/2 401 Unauthorized`
    - Headers: `content-type: application/json`, `x-matched-path: /api/v1/chat/completions`, `server: Vercel`.
- **Audit Findings**:
  - The endpoints are active and confirm an OpenAI-compatible wire contract deployed behind Vercel Edge.
  - Endpoints fail closed with HTTP 401 when no bearer token is supplied.
  - No authenticated requests, live keys, paid API calls, or fake accounts were used.

---

## 4. Alias & Coverage Verification

- **Absence in DurinDoor Registry**:
  - Scanned `open-sse/providers/registry/index.js` and all existing `open-sse/providers/registry/*.js`:
    - Zero entries for `zerolimitai`.
    - Zero references to `zerolimitai.com`.
- **Namespace Collision Check**:
  - Neither ID `"zerolimitai"` nor alias `"zerolimitai"` conflicts with any registered provider or alias in `open-sse/providers/registry/index.js`.
- **Equivalence Assessment**:
  - Not covered by any existing provider alias or generic node configuration. Addition as a distinct provider identity is justified.

---

## 5. Security & Fail-Closed Containment Posture

- **Strict API Key Requirement**:
  - `authType: "apikey"` with Bearer token authentication required on every outbound request.
  - Prohibits `noAuth: true` or `autoComboNoAuth: true`.
  - No hardcoded synthetic keys, anonymous tokens, or default credentials.
- **Brand Assets & Presentation**:
  - No proprietary brand icons or logos are redistributed.
  - Configured with neutral Material symbol `"route"` and two-letter text badge `"ZL"`.
- **Egress Containment**:
  - Base URLs strictly pinned to `https://www.zerolimitai.com/api/v1/`.

---

## 6. Delivered Artifacts & Integration Proposal

### 6.1 Delivered Registry Module
Delivered in `open-sse/providers/registry/zerolimitai.js`:
```javascript
export default {
  id: "zerolimitai",
  alias: "zerolimitai",
  display: {
    name: "ZeroLimit AI",
    icon: "route",
    color: "#6366F1",
    textIcon: "ZL",
    website: "https://www.zerolimitai.com",
    notice: {
      text: "Models are accepted by id and discovered via /api/v1/models; requires account API key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://www.zerolimitai.com/api/v1/chat/completions",
    validateUrl: "https://www.zerolimitai.com/api/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://www.zerolimitai.com/api/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
```

### 6.2 Delivered Unit & Containment Test
Delivered in `tests/unit/provider-zerolimitai-evidence.test.js`:
- Verifies contract compliance with OmniRoute `61e07fb` baseline.
- Validates neutral display metadata.
- Validates pre-integration namespace isolation.
- Validates absence of ID/alias collision with existing registry.
- Validates fail-closed security properties.
- Validates transport merging against `PROVIDER_DEFAULTS`.

### 6.3 Shared Registry Index Integration Proposal
Per repository contract (`AGENTS.md`), `open-sse/providers/registry/index.js` must **never** be edited by hand.
When independent review approves this provider, the integration owner will run:
```bash
npm run gen:registry-index
npm run gen:agent-index
```
This will import `zerolimitai.js` into the barrel in alphabetical code-point order and expose it across `/v1` routes and model catalogs.
