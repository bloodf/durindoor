# Quota Snapshot Evidence & Technical Audit: Issue #1110

**Date**: 2026-11-07  
**Issue**: [#1110: Complete missing provider snapshot adapters (Gemini API-key & xAI)](https://github.com/bloodf/durindoor/issues/1110)  
**Parent Epic**: #1061 Truthful provider readiness and selected coverage  
**Lease**: `795cbc3f-185b-4a0a-8788-9047c42d3dfa`  
**Owner Thread**: `ec0a16dc-f3ce-4f5d-b089-e7bdda40a84d`  
**Base HEAD Verified**: `044632eb8bc4cd51a65340fb6c87100879969e70` (Zero drift, working tree clean)  
**Allocation**: Exact Google high allocation  

---

## 1. Executive Summary & Problem Scope

Issue #1110 addresses missing quota snapshot rows and documented coverage for:
1. **Gemini API-key** connections
2. **xAI** connections

The DurinDoor specification (`docs/features/quota-tracking.mdx`) and provider registry note:
> *"These do not create snapshot rows: gemini API-key, qwen, iFlow, xAI, Xiaomi MiMo, Grok Web, Ollama / Ollama Cloud, Vertex billing, OpenCode variants, NanoGPT..."*

Prior implementations did not distinguish between absence of an authoritative public API and missing adapter code. This technical audit and implementation establishes the exact first-party API surface, rejects synthetic or guessed endpoints, implements documented authenticated APIs, preserves the canonical `UNKNOWN` state when authoritative APIs do not exist on inference credentials, and prevents credential egress or live provider execution.

---

## 2. First-Party API Discovery & Source Evidence

### 2.1 Gemini API-key (`generativelanguage.googleapis.com`)

- **First-Party Discovery**:
  - The public Gemini Developer API (`generativelanguage.googleapis.com`) does not expose a public authenticated REST endpoint to query account quota or remaining balance with a standard Gemini API key (`x-goog-api-key`).
  - Quotas (RPM, TPM, RPD) are enforced at the Google Cloud Project level, not on the API key entity itself.
  - Programmatic quota queries require either the **Google Cloud Quotas API** (`cloudquotas.googleapis.com/v1/projects/{PROJECT}/...`) or **Google Cloud Monitoring API** (`monitoring.googleapis.com`), which both require Google Cloud IAM OAuth/Service Account credentials (`Bearer <OAUTH_TOKEN>`), not a Gemini API key.
  - Internal endpoints such as `https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota` (used by Gemini CLI and Antigravity IDE) require user OAuth tokens (`ya29...`) and are separate from API-key connections.
  - Exceeded quotas return HTTP `429 RESOURCE_EXHAUSTED` reactively during model dispatch.

- **Authoritative Adapter Behavior**:
  - Distinguishes authoritative provider snapshots from local usage estimates (`usageHistory`).
  - Does NOT guess undocumented endpoints or make unauthorized network calls.
  - Returns `outcome: "unknown"` with `reasonCode: "missing"` and `rows: []` when only standard API keys are present.
  - Supports operator-configured custom quota endpoints via `providerSpecificData.quotaEndpoint`, querying via bounded HTTPS (`GET` with `x-goog-api-key`) and normalizing bucketed or limit structures into canonical `ratioQuotaRow` / `quotaRow` records.

### 2.2 xAI (`api.x.ai` vs. `management-api.x.ai`)

- **First-Party Discovery**:
  - The xAI Inference API (`https://api.x.ai`) accepts inference keys (`xai-...`) for completions, models, and embeddings, but exposes **no balance, quota, or usage endpoint**.
  - Rate limits returned on inference requests reside in transient response headers (`x-ratelimit-*`), representing immediate throttling rather than account credit snapshots.
  - Account balance, spending, and prepaid credit management are exposed exclusively via the separate **xAI Management API**:
    - **Base URL**: `https://management-api.x.ai`
    - **Authoritative Endpoint**: `GET /v1/billing/teams/{team_id}/prepaid/balance`
    - **Authentication**: Management API Key with Billing scope (`Authorization: Bearer <MANAGEMENT_KEY>`)
    - **Parameters**: Requires `{team_id}` in path.

- **Authoritative Adapter Behavior**:
  - Distinguishes authoritative provider snapshots from local usage estimates.
  - When standard inference keys are provided without Management API credentials (`teamId` and `managementApiKey`), preserves `outcome: "unknown"` and `reasonCode: "missing"`, refusing to guess non-existent inference balance endpoints.
  - When Management API credentials (`teamId` + `managementApiKey`) are provided in `providerSpecificData`, queries `https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/balance` over bounded HTTPS.
  - Normalizes the prepaid credit balance into canonical `remainingQuotaRow` rows (`dimensionKey: balance:usd`, `unit: usd`).
  - Evaluates zero balance as `state: "exhausted"`, while positive balance is `state: "available"`.

---

## 3. Implementation Assets & Boundaries

### Owned Implementation Files
1. `src/lib/usage/geminiApiKeyQuotaAdapter.js`
   - Canonical source ID: `gemini:api-key-quota:v1`
   - Normalizer: `normalizeGeminiApiKeyQuota`
   - Authoritative fetcher: `fetchGeminiApiKeyQuota`
   - Bounded transport, timeouts, and payload limits inherited from `createProviderRequest`.

2. `src/lib/usage/xaiQuotaAdapter.js`
   - Canonical source ID: `xai:management-prepaid:v1`
   - Base URL: `https://management-api.x.ai`
   - Normalizer: `normalizeXaiPrepaidBalance`
   - Authoritative fetcher: `fetchXaiQuota`
   - Strict separation of inference keys from management keys.

3. `tests/unit/quota-documented-snapshot-1110.test.js`
   - Unit tests covering missing credentials, preservation of `UNKNOWN` state without blind network requests, normalization of authoritative payloads, and operator-configured/management endpoints.

4. `internal/docs/quota-snapshot-evidence-1110.md`
   - This architectural audit and evidence record.

### Strict Boundaries Preserved
- No modifications to generated registry (`open-sse/providers/registry/index.js`).
- No modifications to agent index (`open-sse/AGENT-INDEX.md`).
- No edits to unrelated provider auth, cache, or shared-core infrastructure.
- Zero network guessing or fabricated credentials.
- Zero live provider calls.

---

## 4. Verification & Validation Status

- AST and syntax checks: Passed (`node --check` clean on all implementation and test files).
- Git tree status: Only owned files created, working tree clean of unrelated drift.
- Baseline impact: `tests/__baseline__/known-fails.txt` untouched (0 modifications).
- Local gate status: Source delivery stage complete. Supervised CI gate execution with frozen runner precedes merge.

---

## 5. Required External Actions for Parent Review

1. Parent review of patch and evidence receipt at `/Users/heitor/.config/ai-tooling/evidence/durindoor-new-1110-source-20261107`.
2. Independent qualification review of first-party API references.
3. Supervised execution of V5 Local CI gate checkpoint with frozen runner.
4. Release of lease `795cbc3f-185b-4a0a-8788-9047c42d3dfa` upon completion.
