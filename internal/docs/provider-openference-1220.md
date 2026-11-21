# Openference Provider Port Evaluation & Disposition (#1220)

- **Issue**: [bloodf/durindoor#1220](https://github.com/bloodf/durindoor/issues/1220) (`port(omniroute): evaluate and add openference provider`)
- **Upstream Source Pin**: [`diegosouzapw/OmniRoute@61e07fb7e0d4e1e76111495d3718c9e4d06d2a62`](https://github.com/diegosouzapw/OmniRoute/commit/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62) (OmniRoute release/v3.8.52)
- **Lease**: `689d9fcb-da80-4680-882f-d98fd20678ce`
- **Evaluated Base HEAD**: `044632eb8bc4cd51a65340fb6c87100879969e70` (verified clean, zero drift)
- **Assigned Ownership**: `tests/unit/provider-openference-evidence.test.js`, `internal/docs/provider-openference-1220.md`
- **Final Disposition**: **EXPLICIT UNAVAILABLE / PREREQUISITES ABSENT** (`UNAVAILABLE_PENDING_EXTERNAL_PREREQUISITES`)

---

## 1. Executive Summary

This evaluation analyzes the feasibility of porting the upstream `openference` provider from OmniRoute commit `61e07fb7e0d4e1e76111495d3718c9e4d06d2a62` to DurinDoor.

- **Existing Port (`openference-api`)**: DurinDoor already has a fully functioning, tested, and cataloged port of the API-key variant of Openference: `open-sse/providers/registry/openference-api.js` (alias `ofa`, category `apikey`, chat endpoint `https://api.openference.com/v1/chat/completions`, models endpoint `https://api.openference.com/v1/models`), ported in PR #1490 (issue #1221).
- **Canonical OAuth Provider (`openference`)**: The upstream repository defines a separate canonical provider node `openference` (alias `of`) utilizing OAuth PKCE authorization. However, rigorous source analysis confirms that upstream uses an unverified placeholder client ID (`"omniroute"`), and there is no documented or operational public OAuth registration available for Openference.
- **Disposition**: Per policy and security mandates ("Never invent OAuthclient/redirect/scopes or expose credentials; no actual provider auth/calls. Preserve encryption/accountscope/egress. No shared OAuth/registry/index edit."), canonical `openference` OAuth cannot be mechanically ported. It is formally classified as **UNAVAILABLE** pending external prerequisites.

---

## 2. Pinned Upstream Source Analysis (`61e07fb`)

### 2.1. Registry Entry: `open-sse/config/providers/registry/openference/index.ts`
- **Blob SHA**: `9ef2cfc768ad5986949f51f523c28b3bcd9e6934` (1,084 bytes)
- **Contract**:
  ```typescript
  export const openferenceProvider: RegistryEntry = {
    id: "openference",
    alias: "of",
    format: "openai",
    executor: "default",
    baseUrl: "https://api.openference.com/v1/chat/completions",
    responsesBaseUrl: "https://api.openference.com/v1/responses",
    authType: "oauth",
    authHeader: "bearer",
    passthroughModels: true,
    oauth: {
      clientIdDefault: resolvePublicCred("openference_id"),
      tokenUrl: "https://openference.com/oauth/token",
    },
    models: [
      { id: "GLM-5.2", name: "GLM 5.2", contextLength: 850000 },
      { id: "Qwen3.8 27b", name: "Qwen3.8 27B", contextLength: 262144 },
      { id: "Llama 3.2 3B", name: "Llama 3.2 3B", contextLength: 131072 },
    ],
  };
  ```

### 2.2. OAuth Implementation: `src/lib/oauth/providers/openference.ts`
- **Blob SHA**: `15fb8e8ef83be0c04412cd40b1e671b89d63cfee` (3,969 bytes)
- **Configuration** (`src/lib/oauth/constants/oauth.ts`):
  - `clientId`: `resolvePublicCred("openference_id")`
  - `authorizeUrl`: `https://openference.com/app/oauth/authorize`
  - `tokenUrl`: `https://openference.com/oauth/token`
  - `userinfoUrl`: `https://openference.com/oauth/userinfo`
  - `scope`: `"openid profile email model:invoke offline_access"`
  - `codeChallengeMethod`: `"S256"`
  - `loopbackPort`: `56123`
  - `callbackPath`: `"/callback"`
  - `callbackHost`: `"127.0.0.1"`
- **Token Handling**:
  - `flowType`: `authorization_code_pkce`
  - Decodes `id_token` JWT payload for `email` and `name`.
  - Exchanges authorization code via POST to `tokenUrl`.
  - Queries `userinfoUrl` with Bearer token.
  - Maps `accessToken`, `refreshToken`, `idToken`, and `expiresIn`.

### 2.3. The Upstream Credential Mask Analysis
In `open-sse/utils/publicCreds.ts`:
- The embedded default for `openference_id` is:
  ```typescript
  openference_id: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  ```
- The XOR mask is `MASK = "omniroute-public-v1"`.
- When XORed with 0, each byte matches `MASK`: `[0^111, 0^109, 0^110, 0^105, 0^114, 0^111, 0^117, 0^116, 0^101]` -> `"omniroute"`.
- As explicitly documented in upstream comments: *"The plaintext equals the first nine bytes of MASK, so its XOR-masked representation is nine zero bytes."*
- This confirms that upstream **did not possess a real public OAuth client ID** from Openference and embedded a synthetic dummy string `"omniroute"`.

---

## 3. DurinDoor Current State & Equivalent Aliases

| Provider ID | Alias | Auth Type | Category | Status in DurinDoor | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `openference-api` | `ofa` | `apikey` | `apikey` | **PRESENT** | Ported in PR #1490 (issue #1221). Registered in `open-sse/providers/registry/openference-api.js`. Live models discovery supported via `https://api.openference.com/v1/models`. |
| `openference` | `of` | `oauth` | `oauth-session` | **MISSING / UNAVAILABLE** | Canonical OAuth provider. Recorded as `missing` in `internal/docs/omniroute-provider-matrix.json:8210-8236`. |

---

## 4. Root Cause of Unavailable Disposition

1. **Absence of Real OAuth Credentials**:
   Neither OmniRoute nor Openference provides a verified, production-ready public OAuth client ID for desktop/web PKCE authorization. The upstream value `"omniroute"` is a local mock placeholder. Attempting live authorization against `https://openference.com/app/oauth/authorize` with client ID `"omniroute"` fails upstream.
2. **Strict Prohibition on Synthetic/Invented Credentials**:
   Core policy dictates: *"Never invent OAuthclient/redirect/scopes or expose credentials; no actual provider auth/calls."* Fabricating a client ID or stubbing a live OAuth lifecycle without verified provider infrastructure is forbidden.
3. **Preservation of Security, Encryption, and Account Scoping**:
   DurinDoor securely encrypts OAuth tokens in SQLite with per-account isolation and enforces egress controls. Implementing a pseudo-OAuth provider would introduce dead code, confusing configuration surfaces, and potential session-handling vulnerabilities.
4. **Architectural Scope Restriction**:
   Integrating an OAuth provider into DurinDoor requires modifying shared infrastructure:
   - `src/lib/oauth/constants/oauth.js`
   - `src/lib/oauth/providers.js`
   - `open-sse/providers/registry/index.js` (which must be generated, never hand-edited)
   The task strictly confines ownership: *"OWN openference-specific files, tests/unit/provider-openference-evidence.test.js and internal/docs/provider-openference-1220.md ONLY. No shared OAuth/registry/index edit."*

---

## 5. Required External Actions to Unblock

To transition canonical `openference` (OAuth) to supported status in the future, the following external actions are strictly required:

1. **Official OAuth Registration**:
   Obtain an officially registered OAuth 2.0 Client ID from Openference with PKCE support (`S256`), designated for native/local application authorization.
2. **Endpoint & Scope Documentation**:
   Confirm official public URLs for:
   - Authorization URL (`authorizeUrl`)
   - Token exchange URL (`tokenUrl`)
   - UserInfo endpoint (`userinfoUrl`)
   - Token refresh URL and revocation endpoint
   - Documented OAuth scopes (e.g., `model:invoke`, `offline_access`) and token expiration semantics.
3. **Account-Backed Verification**:
   Execute end-to-end token acquisition and refresh verification with real test credentials to ensure that issued JWT tokens function as valid Bearer tokens on `https://api.openference.com/v1/chat/completions`.
4. **Shared Infrastructure PR with Independent Review**:
   Once items 1–3 are formally verified, submit a coordinated PR touching `src/lib/oauth/` and generating registry indices via `npm run gen:registry-index` and `npm run gen:agent-index`, accompanied by independent security review.

---

## 6. Regression & Evidence Verification

The grounded unit test [tests/unit/provider-openference-evidence.test.js](file:///Users/heitor/.t3/worktrees/durindoor/t3-35b96c93/tests/unit/provider-openference-evidence.test.js) verifies:
- The verified structure and presence of `openference-api` (API-key).
- The absence of unverified canonical `openference` OAuth from the active registry and active OAuth provider roster.
- Matrix catalog alignment in `internal/docs/omniroute-provider-matrix.json`.
- Enforcement of the `UNAVAILABLE_PENDING_EXTERNAL_PREREQUISITES` disposition contract.
