# Private ChatGPT plan OAuth protocol

The internal module `src/lib/oauth/chatgptPlanProtocol.js` implements OpenAI's public-client protocol for private and open-source apps. It uses fixed OpenAI endpoints and the `https://api.openai.com/v1` resource. It has no client secret. The transport is a required trusted Fetch-compatible adapter that enforces HTTPS validation, the supplied abort signal and `redirect: "error"`, and must not log request or response contents.

- `startChatGptPlanAuthorization({ redirectUri, hostId, registration? })` returns `{ attempt, authorizationUrl }`. Supply the host's stable ID and an exact `http://127.0.0.1:<port>/auth/callback` URI. Only the port may vary between attempts. Keep the short-lived attempt private and consume it once in the caller. The URL can contain an ID token hint and must stay out of logs. For a returning account, pass the selected connection's verified issuer, subject and issued client ID, with its own optional retained ID token and verified email.
- `parseChatGptPlanCallback(attempt, callbackUrl)` checks the original callback URI, state and expiry before accepting a code or signaling denial. Initial registration requires an issued `oaiapp_` client ID. A returning callback may omit the client ID or repeat the saved one. On `invalid_grant`, discard the code. An issued ID from an incomplete attempt remains provisional until identity is verified.
- `createChatGptPlanProtocol({ fetchAdapter, clock? }).exchangeCode(attempt, callbackUrl)` validates the callback again, exchanges the code with the issued client ID and exact original redirect URI, then verifies the ID token against OpenAI's pinned JWKS using RS256. It checks issuer, issued-client audience, expiry, nonce and subject. A returning sign-in must match the saved subject. A valid sign-in can return `planEnabled: false`. Gate plan use on the token endpoint's granted direct-use and resource-invocation scopes.
- `refresh(record)` uses the issued client ID and refresh token from the same saved connection. It returns a replacement record with the rotated refresh token, new access token and updated timing and scopes. An omitted refresh scope preserves the previous grant. Refresh keeps the original verified identity and ID token hint. Serialize refresh for each connection and replace the record atomically only after success. Use expiry and the returned earliest refresh time to schedule renewal.
- `revoke(record)` posts the refresh token and issued client ID and treats an empty HTTP 200 as confirmation. The caller owns retries and local sign-out. Retain the account/client mapping after removing session tokens. Errors expose a fixed code and, for HTTP failures, the status. Callback descriptions, endpoint bodies and transport exception text are excluded from diagnostics.

Store each connection's `issuer`, verified `subject`, issued `clientId`, associated `hostId`, optional verified `email`, retained `idToken`, `accessToken`, optional `refreshToken`, `tokenType`, granted `scopes`, `savedAt`, `expiresAt` and optional `earliestRefreshAt` together in an encrypted record. Times are Unix milliseconds. Derive `planEnabled` from the scopes. Keep registrations separate even when email matches. Attempt state, nonce, PKCE verifier and authorization code belong only to the pending exchange. Keep the runtime's stable host ID independently so VM credential transfer preserves the VM's own ID for its next authorization.

The authorization and identity checks adapt OmniRoute's [chatgptProtocol.ts](https://github.com/diegosouzapw/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/src/lib/oauth/chatgptProtocol.ts), and refresh fields and error codes draw on its [ChatGPT refresh provider](https://github.com/diegosouzapw/OmniRoute/blob/b748429cf5b3aeb142a708fd3e8751b6918b9dc8/open-sse/services/tokenRefresh/providers/chatgpt.ts). OpenAI's protocol defines the wire contract. [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions), [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference), [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery), [Self-hosted VMs](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms).

## Private account service

Create `createChatGptPlanAccounts({ fetchAdapter, clock? })` from
`src/lib/oauth/chatgptPlanAccounts.js` in the trusted runtime. The owner keeps
`DATA_DIR/chatgpt-plan-host-id` stable across restarts and uses a distinct
persistent data directory for each host. Keep authorization URLs, transfer
records and returned session credentials private.

- `beginAuthorization({ redirectUri, selection? })` returns an authorization
  URL and an opaque in-memory handle. Omit the selection for an initial private
  sign-in. Pass the saved selection for returning sign-in.
  `finishAuthorization(handle, callbackUrl)` consumes the handle before
  exchange and returns the verified `{ id, issuer, subject, clientId }`
  selection. Start a fresh attempt after failure.
- `readAccount(selection)` reads that host's selected account.
  `refresh(selection)` atomically commits the replacement tokens, scopes and
  timing. Schedule renewal near expiry and at or after `earliestRefreshAt` when
  supplied. A durable claim blocks refresh and remote revocation while the
  token may already have been sent. A failed or interrupted refresh leaves the
  claim in place. Recover with a fresh sign-in for the selected registration.
- `signOut(selection)` attempts remote revocation before clearing the three
  local tokens. Retry transient revocation failures with backoff. Explicit
  `signOut(selection, { localOnly: true })` clears local credentials and
  reports unconfirmed revocation when a refresh token was present. The owner
  can disconnect the app in ChatGPT Settings. The account selection survives
  sign-out.
- For an owner-operated VM, initialize the destination host identity first and
  complete sign-in on the local machine. `detachForVm(selection)` clears
  the source session and returns its transfer record. Transfer it privately
  over an authenticated secure channel, then call
  `bindFromOwnerTransfer(selection, record)` in the destination runtime.
  Binding accepts a trusted record from the source service, requires a fresh
  destination slot, and encrypts the credentials with the destination key.
  The VM owns subsequent refreshes and uses its own host ID for reauthorization.
  Treat the transfer as a one-time handoff and destroy temporary copies.
  If the transfer record is lost after detaching, sign in again.
  [OpenAI self-hosted VM guidance](https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms)

The service stores private records in the database's
`privateChatGptPlanAccounts` namespace and uses the existing connection
credential encoding for `accessToken`, `refreshToken` and `idToken`.
`providerSpecificData` contains the registration identifiers, grant scopes
and timing metadata. The service requires a shared transactional adapter and
follows DurinDoor's `claimProviderConnectionPing` writer-lock pattern in
`connectionsRepo.js`. Credential comparison and a random revision fence
stale writes, including writes after sign-out or reauthorization.

## Owner enrollment into a gateway connection

Model discovery requires the same owner opt-in, normal provider registration,
an active gateway API key explicitly scoped to the saved OAuth connection, and
its matching private account selection. `/v1/models` and model lookup fetch the
account's current catalog without sharing or retaining it in catalog caches.
Missing credentials or a failed upstream catalog produce no private models.

This is an explicitly enabled private local operation. Set
`DURINDOOR_CHATGPT_PLAN_ENROLLMENT=1` on the owner-controlled runtime and
restart it. The endpoint accepts only loopback peers proven by the local server,
a valid dashboard session or machine-bound CLI token, and a same-origin request.
An open dashboard or inference API key alone is insufficient. Keep the flag enabled while using the plan; disabling it stops enrollment,
discovery and dispatch. The connection is hidden from the generic public OAuth
flow and must be created through this guarded endpoint.

From an authenticated local dashboard session, POST JSON to
`/api/oauth/chatgpt-plan/enrollment`. Use `{"action":"create","name":"Owner plan"}`
to create an inactive OAuth connection, then `{"action":"start","connectionId":"<id>"}`.
Open the returned private `authorizationUrl` on that same machine; do not log or
share it. Poll with `{"action":"status","attemptId":"<id>"}`. A completed
attempt binds the verified private selection to that connection; `failed` requires
a fresh attempt. Status is consumed when terminal. To stop a pending attempt use
`{"action":"cancel","attemptId":"<id>"}`. To sign in again, start the same
connection: its saved private selection is used automatically. To sign out use
`{"action":"signOut","connectionId":"<id>"}`; `"localOnly":true` explicitly
removes local credentials without confirmed remote revocation. The selection
remains for later sign-in. Account references are never supplied by the caller.
For example, from the authenticated local dashboard's same-origin JavaScript
console, the following creates the connection without exposing the session cookie:

```js
const post = async (body) => (await fetch("/api/oauth/chatgpt-plan/enrollment", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
})).json();
const { connectionId } = await post({ action: "create", name: "Owner plan" });
const { attemptId, authorizationUrl } = await post({ action: "start", connectionId });
// Open authorizationUrl privately, then poll:
await post({ action: "status", attemptId });
```

All requests must originate on the machine running the loopback listener. The
endpoint is not a hosted subscription gateway and must not be exposed through a
remote proxy or used to enroll another person's account.

For an owner-operated VM, follow the private-service handoff above: initialize
its separate persistent data directory and host ID, detach on the source, send
the transfer record over an authenticated secure channel, and bind it through
`bindFromOwnerTransfer` in the destination's trusted runtime. Bind the resulting
verified selection to the destination's own OAuth connection using the repository
compare-and-set and its current connection snapshot. Never send transfer records,
credentials, or authorization URLs through the public connection API. The source
session is cleared before transfer; destroy temporary copies and recover from a
lost transfer by signing in again. No shared refresh token may remain active on
both machines.
