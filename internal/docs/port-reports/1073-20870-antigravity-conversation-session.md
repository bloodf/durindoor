# #1073 — Antigravity conversation session ownership and wire session IDs

## Summary and Disposition

**Disposition: Already effective in existing local architecture.** No product, routing, or translator changes are required.

Inspected [OmniRoute #19876](https://github.com/cheaper-inference/OmniRoute/pull/19876) ("fix(antigravity): scope the upstream sessionId per conversation, not per account"), merged into `release/v3.8.55` via contributor train [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) (commit / PR head `b871c0747d768d379f8aa16a53731e437e2ed186`).

OmniRoute previously derived the Cloud Code `request.sessionId` solely from the account email via `getAntigravitySessionId(credentials)` (#13305), causing parallel conversations sharing an Antigravity account to overwrite each other's upstream prompt cache in Google Cloud Code, and causing non-streaming server-tool follow-up turns in `runNonStreamingResponse` to drop to the account session. OmniRoute addressed this by plumbing `antigravitySessionKey` through `chatCore.ts` and `translateRequest` options, and deriving `sessionId` from `${account}\x1f${conversation}`.

In DurinDoor, conversation-scoped session resolution is already centralized and active across all Antigravity ingress paths via [sessionManager.js](../../../open-sse/utils/sessionManager.js), [translator/index.js](../../../open-sse/translator/index.js), and [executors/antigravity.js](../../../open-sse/executors/antigravity.js). Both native and translated routes resolve distinct conversation identifiers into the upstream Google Cloud Code `-<uint64>` wire format (`toNumericSessionId`), retries remain immutable, streaming and non-streaming modes dispatch identical envelope sessions, and fallbacks with no client conversation evidence are strictly segregated without leaking account or credential state.

---

## Provenance and Source Analysis

- **Upstream PR**: [OmniRoute #19876](https://github.com/cheaper-inference/OmniRoute/pull/19876)
- **Contributor Train Provenance**: [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870) (`chore(release): contributor train e1b of 21 PRs for v3.8.55 (2026-11-21)`)
- **Verified Public PR Head**: `b871c0747d768d379f8aa16a53731e437e2ed186`
- **Target Branch**: `release/v3.8.55` (base `release/v3.8.54`)
- **Author**: `@adevwithpurpose`

### Upstream Problem and Implementation
1. **Root cause in OmniRoute**: `wrapInCloudCodeEnvelope` derived `sessionId` exclusively from `getAntigravitySessionId(credentials)`. In OmniRoute, `getAntigravitySessionId` produced a stable hash of the connection account email (`deriveAntigravitySessionId(accountKey)`). All requests on an account transmitted identical `request.sessionId` values regardless of client conversation. In parallel workloads (e.g. multiple agents running simultaneously on one account), requests constantly evicted each other's Cloud Code prompt cache. Additionally, OmniRoute's autonomous server-tool follow-up loop (`runNonStreamingResponse` in `chatCore/nonStreamingResponse.ts`) called `translateRequest` on the next turn without forwarding conversation context.
2. **Upstream Fix in #19876**:
   - In `chatCore.ts`: Added `const antigravitySessionKey = conversationId || sessionAffinityKey || null;` and passed it into `translateRequest` options and `runNonStreamingResponse`.
   - In `open-sse/translator/index.ts`: Destructured `options.antigravitySessionKey` and attached it as `credentials._antigravitySessionKey`.
   - In `open-sse/services/antigravityIdentity.ts`: Added `getAntigravityConversationSessionId(credentials, conversationKey)`: when `conversationKey` is non-empty, derives `deriveAntigravitySessionId(`${account}\x1f${conversation}`)`, falling back to `getAntigravitySessionId(credentials)`.
   - In `open-sse/translator/request/openai-to-gemini.ts`: `wrapInCloudCodeEnvelope` was updated to call `getAntigravityConversationSessionId(credentials, credentials?._antigravitySessionKey)`.
   - Added unit test suite `tests/unit/antigravity-conversation-session-id.test.ts`.

---

## Comparative Analysis: DurinDoor Wire Session IDs

DurinDoor does not use OmniRoute's `antigravityIdentity.ts` or ad-hoc translator options. Instead, session lifecycle and provenance are centrally resolved in [sessionManager.js](../../../open-sse/utils/sessionManager.js) and injected directly at translator ingress and executor transformation.

### 1. Native Antigravity Route (`FORMATS.ANTIGRAVITY` -> `FORMATS.ANTIGRAVITY`)
- **Execution Path**:
  In [chatCore.js](../../../open-sse/handlers/chatCore.js), when source and target formats are both `FORMATS.ANTIGRAVITY`, `passthrough` is true and translation is bypassed. Outbound normalization is performed by [AntigravityExecutor.transformRequest](../../../open-sse/executors/antigravity.js):
  ```javascript
  const rawSessionId = body.request?.sessionId || resolveSessionId({
    headers: credentials?.rawHeaders,
    body,
    connectionId: credentials?.email || credentials?.connectionId,
    scope: "antigravity"
  });
  const sessionId = toNumericSessionId(rawSessionId) || rawSessionId;
  ```
- **Wire Contract**:
  - If the client supplies `body.request.sessionId`, it is preserved verbatim (normalized to `-<uint64>` if not already numeric).
  - If omitted, `resolveSessionId` inspects `body.requestId` (extracting UUIDs matching `/^[a-z]+\/([0-9a-f-]{36})\//i`), request headers, or assistant text.
  - The envelope `request.sessionId` is populated with `sessionId`.
  - The top-level `requestId` is synchronized via `buildIdeRequestId` to `agent/${conversationId}/${Date.now()}/${trajectoryId}/${step}`, where `conversationId = uuidFromSeed("antigravity:conversation:" + sessionId)`. Native conversation identity and session cache remain 1:1 on the wire.

### 2. Translated Routes (OpenAI / Claude -> Antigravity)
- **Execution Path**:
  - In [translator/index.js](../../../open-sse/translator/index.js), before format conversion strips envelope fields or client metadata:
    ```javascript
    const clientSessionId = captureSessionId(result, credentials, connectionId, targetFormat);
    if (credentials) {
      credentials._clientSessionId = clientSessionId;
    }
    ```
  - In translator/request/openai-to-gemini.js:
    Both `wrapInCloudCodeEnvelope` (for Gemini-family models) and `wrapInCloudCodeEnvelopeForClaude` (for Claude models on Antigravity) set:
    ```javascript
    sessionId: toNumericSessionId(credentials?._clientSessionId) ||
               (isAntigravity ? deriveSessionId(credentials?.email || credentials?.connectionId) : generateSessionId())
    ```
- **Wire Contract**:
  - `captureSessionId` extracts the conversation ID from explicit headers (`x-session-id`, `session-id`, `session_id`, `x-amp-thread-id`, `x-client-request-id`), body fields (`prompt_cache_key`, `session_id`, `conversation_id`, `metadata.user_id`), or Claude Code metadata/headers.
  - If no client header/body key exists, `assistantTextSessionId` accumulates assistant content across prior turns and assigns a conversation-stable session.
  - `toNumericSessionId` hashes the string into Google Cloud Code's `-<uint64>` format (`crypto.createHash("sha256").update(v).digest().readBigUInt64BE(0) & 0x7fffffffffffffffn`).
  - When [AntigravityExecutor.transformRequest](../../../open-sse/executors/antigravity.js) runs, `body.request.sessionId` is already populated; the executor passes it through without re-resolving or falling back to the account. Parallel conversations on the same account produce distinct wire session IDs.

### 3. Retries and Stream Recovery
- **In-stream empty retries**:
  In [chatCore.js](../../../open-sse/handlers/chatCore.js), `createEmptyRetryStream` invokes `reexecute()`, which executes the identical `translatedBody`. The `request.sessionId` on `translatedBody` is reused without modification.
- **Credential / token refresh retries**:
  In [chatCore.js](../../../open-sse/handlers/chatCore.js), upon 401 refresh, `executeProvider()` re-runs with the immutable route and existing `translatedBody`. The session ID remains stable across OAuth token rotation.
- **Historical thinking recovery retries**:
  In [chatCore.js](../../../open-sse/handlers/chatCore.js), recovery re-runs `executeProvider()` with the same `translatedBody` and same session ID.

### 4. Streaming vs. Non-Streaming
- In DurinDoor, request translation and session binding occur before execution (`chatCore.js` line 1379 `executeProvider()`).
- The wire payload `translatedBody` with its resolved `request.sessionId` is identical whether dispatched to `/v1internal:streamGenerateContent?alt=sse` (`stream: true`) or `/v1internal:generateContent` (`stream: false`).
- Downstream response processing in [streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js) and [nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js) does not run an autonomous server-tool re-dispatch loop (`chatCore/nonStreamingResponse.ts` `followUpLeg` in OmniRoute does not exist in DurinDoor). DurinDoor delivers tool calls to the client directly. Thus, the follow-up re-translation regression present in OmniRoute does not occur here.

### 5. Locally Pinned Per-Conversation IDs vs. Selected Fallback
DurinDoor's [resolveSessionIdWithProvenance](../../../open-sse/utils/sessionManager.js) explicitly distinguishes conversation evidence from fallback:
1. **Client-Provided Evidence**:
   - Matches client conversation fields (`conversation_id`, `session_id`, `prompt_cache_key`, `metadata.user_id`, or headers).
   - Provenance is marked `{ requestScoped: false }`.
   - Multiple parallel conversations have distinct keys; turns within the same conversation reuse the key.
2. **Accumulated Assistant Text**:
   - If client conversation markers are absent, `assistantTextSessionId` hashes accumulated assistant turns (>= 50 chars).
   - Provenance is marked `{ requestScoped: false }`.
   - Distinct parallel tasks receive distinct assistant text hashes, maintaining cache continuity without client header support.
3. **Selected Fallback with No Client Evidence**:
   - Occurs on initial single-turn prompts with no client session headers and no assistant history.
   - Falls back to `deriveSessionId(connectionId)`, which allocates a per-connection memory-cached ID in `runtimeSessionStore` (capped at 1,000 LRU entries with TTL).
   - Provenance is explicitly flagged via `credentials._clientSessionIsGenerated = true`.
   - This prevents synthetic or connection-level IDs from being treated as authoritative client conversation IDs, while ensuring that the first turn receives a stable identifier that automatically transitions to `assistantTextSessionId` on the second turn.

---

## Privacy, Account Boundaries, and Sign-in Isolation

- **Boundary Separation**: Account credentials (`accessToken`, `projectId`, `email`, `connectionId`) are never combined into client-exposed conversation keys.
- **One-Way Mapping**: Upstream wire session IDs are converted to `-<uint64>` via `toNumericSessionId` using SHA-256. The numeric wire ID exposes no email, project ID, client session string, or account credential.
- **Account Selection & Auth Isolation**: Session affinity in `src/sse/services/auth.js` operates strictly within the authenticated API key's allowed connections and respects health check / quota state. No cross-account credential leakage occurs.
- **No Credential Access or Network Traffic**: This review was conducted entirely through static code inspection and public pinned git objects. No credential stores were accessed, no provider traffic was transmitted, and no paid APIs were invoked.

---

## Verification and Acceptance Evidence

1. **Source Inspection Evidence**:
   - Merged PR: [OmniRoute #19876](https://github.com/cheaper-inference/OmniRoute/pull/19876)
   - PR Head SHA: `b871c0747d768d379f8aa16a53731e437e2ed186`
   - Provenance Train: [OmniRoute #20870](https://github.com/cheaper-inference/OmniRoute/pull/20870)
2. **Local Repository Reference Resolution**:
   - `open-sse/utils/sessionManager.js` resolves via [sessionManager.js](../../../open-sse/utils/sessionManager.js)
   - `open-sse/translator/index.js` resolves via [translator/index.js](../../../open-sse/translator/index.js)
   - `open-sse/translator/request/openai-to-gemini.js` resolves via [openai-to-gemini.js](../../../open-sse/translator/request/openai-to-gemini.js)
   - `open-sse/executors/antigravity.js` resolves via [antigravity.js](../../../open-sse/executors/antigravity.js)
   - `open-sse/handlers/chatCore.js` resolves via [chatCore.js](../../../open-sse/handlers/chatCore.js)
   - `open-sse/handlers/chatCore/nonStreamingHandler.js` resolves via [nonStreamingHandler.js](../../../open-sse/handlers/chatCore/nonStreamingHandler.js)
   - `tests/unit/omni-antigravity-claude-wire-shape.test.js` resolves via [omni-antigravity-claude-wire-shape.test.js](../../../tests/unit/omni-antigravity-claude-wire-shape.test.js)
   - Related port report: [1073-antigravity-claude-wire-shape.md](1073-antigravity-claude-wire-shape.md)
3. **Acceptance Verification Command**:
   ```bash
   test -s internal/docs/port-reports/1073-20870-antigravity-conversation-session.md && rg -q -F b871c0747d768d379f8aa16a53731e437e2ed186 internal/docs/port-reports/1073-20870-antigravity-conversation-session.md
   ```

Refs #1073
