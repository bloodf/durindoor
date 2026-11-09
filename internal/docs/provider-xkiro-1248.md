# Provider Candidate Disposition: `xkiro` (Issue #1248)

## Overview & Scope

- **Tracking Issue**: [#1248](https://github.com/bloodf/durindoor/issues/1248)
- **Candidate Provider**: `xkiro` (OmniRoute release/v3.8.52 candidate snapshot `open-sse/config/providers/registry/xkiro/index.ts`)
- **Native Provider**: `kiro` (AWS Q Developer / CodeWhisperer eventstream transport)
- **Current Main Reference**: `044632eb8bc4cd51a65340fb6c87100879969e70`
- **Containment Source**: PR #1286 (closed, superseded) integrated into PR #1298 (merged as commit `e4f465b3c`)

This document defines the architecture, containment disposition, and security boundaries separating the unadmitted candidate `xkiro` from the native `kiro` implementation.

---

## Architecture & Transport Trace

### 1. Installed Native `kiro`
- **Transport**: AWS binary EventStream (`application/vnd.amazon.eventstream`).
- **Endpoint**: `https://q.{region}.amazonaws.com/generateAssistantResponse`.
- **Authentication**:
  - API Key: Sent via Bearer header with explicit `tokentype: API_KEY` discriminator.
  - Enterprise / Microsoft Entra: Sent with `TokenType: EXTERNAL_IDP`.
  - AWS SSO / IAM Identity Center: Validated against AWS SSO cache (`~/.aws/sso/cache`) with regional profile ARNs (`regionFromProfileArn`, `ListAvailableProfiles`).
- **Catalog**: Fetched via control-plane GET `https://q.{region}.amazonaws.com/ListAvailableModels?origin=AI_EDITOR` returning AWS model limits and synthetic suffix expansion (`-thinking`, `-agentic`).
- **Implementation**:
  - Executor: `open-sse/executors/kiro.js` (`KiroExecutor`)
  - Catalog & SSO: `open-sse/services/kiroModels.js`
  - Constants & Regions: `open-sse/config/kiroConstants.js`, `open-sse/config/kiroRegions.js`

### 2. Candidate `xkiro`
- **Upstream Origin**: OmniRoute `open-sse/config/providers/registry/xkiro/index.ts`.
- **Reported Wire Protocol**: Standard OpenAI HTTP JSON (`transport.format: "openai"`, base `https://api.xkiro.com/v1/chat/completions`).
- **Reported Auth**: Standard Bearer API key (`Authorization: Bearer <key>`).
- **Nature**: Third-party resale / proxy gateway presenting an OpenAI-compatible interface in front of Kiro models.

### 3. Critical Boundary: No Aliasing, No Shared Transport
- `xkiro` is **NOT** an alias or alternative endpoint for AWS CodeWhisperer.
- Attempting to route `xkiro` credentials to AWS endpoints (`q.*.amazonaws.com`) would trigger instant 401/403/400 rejections and leak credentials to unrelated third parties.
- Attempting to treat native `kiro` credentials as OpenAI bearer tokens against `api.xkiro.com` would violate credential isolation and trust boundaries.
- The repository strictly preserves `normalizeProviderId("xkiro") === "xkiro"` and keeps `xkiro` absent from `AI_PROVIDERS` and `PROVIDERS`.

---

## Rejection BEFORE Credential-Bearing Transport

Security policy mandates that unsupported provider candidates fail closed **before** any socket is opened or credentials leave the process.

In `src/app/api/providers/providerProbe.js`:
```javascript
const probe = buildRegistryProviderProbe(provider, apiKey, providerSpecificData);
if (!probe) return null;
```
For candidate `"xkiro"`:
1. `buildRegistryProviderProbe("xkiro", ...)` resolves to `null` because `PROVIDERS.xkiro` does not exist and no specialty validator matches `"xkiro"`.
2. `probeRegistryProvider("xkiro", ...)` returns `null` immediately.
3. No network fetcher (`fetch`, `proxyAwareFetch`, `guardedProbeFetch`) is invoked.
4. Callers map `null` to HTTP 400 (`"Provider validation not supported"`).
5. Zero credential transmission occurs.

---

## Prior Containment Analysis (PR #1286 / PR #1298)

1. **Original PR #1286**:
   - Authored at head `8b9cd980d65519aec3e338424c732d4f76089f30`.
   - Introduced offline test fixture `tests/unit/fleet-provider-xkiro-acceptance.test.js`.
   - Blob hash: `36c75a42bf85d761adb9c78a6b7c4a5c4578044e`.
2. **Integration PR #1298**:
   - Combined provider boundary regressions, including `tests/unit/fleet-provider-xkiro-acceptance.test.js` byte-for-byte (blob `36c75a42bf85d761adb9c78a6b7c4a5c4578044e`).
   - Passed full local CI gate and merged to `main` as commit `e4f465b3c9aaa483d8ccad8030521a63688a38e1`.
3. **Closure of PR #1286**:
   - Superseded by PR #1298 and closed during v5 backlog cleanup.
4. **Current Status on `main` (`044632eb8bc4cd51a65340fb6c87100879969e70`)**:
   - `tests/unit/fleet-provider-xkiro-acceptance.test.js` is present with exact blob `36c75a42bf85d761adb9c78a6b7c4a5c4578044e`.
   - Prior containment is complete and verified.

---

## Source Containment vs. Account-Backed Acceptance

The presence of offline test fixtures (`fleet-provider-xkiro-acceptance.test.js`, `provider-xkiro-disposition.test.js`) verifies only **source-level containment and identity isolation**. It does **not** constitute proof of live functionality, provider entitlement, or production readiness:

- **Source / Fixture Proof**: Proves that the code does not crash, does not leak credentials, and refuses to treat `xkiro` as `kiro`.
- **Account-Backed Acceptance**: Requires live valid credentials, end-to-end streaming evaluation, model discovery verification, and legal terms confirmation.
- **Current Main State**: Candidate `xkiro` remains unadmitted.

---

## Required External Actions for Future Support

Before any production registration (`open-sse/providers/registry/xkiro.js`) can be considered:

1. **Gateway Terms & Resale Audit**:
   - Confirm legal compliance, SLA, and terms of service for `api.xkiro.com` resale of Kiro-derived models.
2. **Account Entitlement & Provisioning**:
   - Obtain dedicated test account credentials outside agent execution boundaries.
3. **Live Contract Validation (Staged & Supervised)**:
   - Verify `/v1/models` against live response schemas.
   - Verify `/v1/chat/completions` for standard streaming, tool call schemas, and error responses.
4. **Independent Gate Review**:
   - Full V5 Local CI gate run with frozen runner evidence.
