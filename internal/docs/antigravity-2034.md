# Antigravity contract comparison for #2034

Compared on 2026-11-20, without provider credentials or account traffic. These are source comparisons, not evidence that Google currently accepts any particular client, model, or account.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Subject `fix(codex): strip uniqueItems keyword from tool parameter schemas`. |
| EasyCLIProxyAPI | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | Desktop console for CLIProxyAPI. |
| OmniRoute | [`fbd339668384803bc3a9d42370fc413a55e013d5`](https://github.com/cheaper-inference/OmniRoute/commit/fbd339668384803bc3a9d42370fc413a55e013d5) | Release-train merge for v3.8.55 (`chore(release): rafacpti23 train b of 11 PRs for v3.8.55`). The `v3.8.55` tag was not published when this was read; the SHA is the commit on the `release/v3.8.55` line. |
| DurinDoor | `3164ce3095774d5f7da49b3922195dd7376e6bb5` | Comparison base for the reproduction. |

Every upstream path cited below was fetched at the SHA above and resolved with HTTP 200.

## Sign-in and project provisioning

- [CLIProxyAPI at 6faa8d2](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d): [OAuth constants](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/constants.go) and [authentication and project provisioning](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/auth.go). Its client is embedded; DurinDoor deliberately requires operator-supplied client settings. Both request cloud-platform, userinfo email/profile, cclog and experimentsandconfigs; CLIProxyAPI also requests aicode. Both use Google authorization and token endpoints; CLIProxyAPI uses v2 userinfo and daily Cloud Code for project provisioning, while DurinDoor uses v1 userinfo and production Cloud Code. CLIProxyAPI loads a project first, then polls onboarding when missing and takes the returned project; this repair follows that control flow without copying credentials or adding scopes.
- [EasyCLIProxyAPI at e4223d5](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/README.md) is a desktop console managing a CLIProxyAPI core for this OAuth/proxy path, rather than an independent provider implementation. It delegates every provider contract to that core: the README lists "Antigravity OAuth" as an authorization entry point and describes starting, stopping and upgrading the CLIProxyAPI core, plus routing all requests through the unified local CLIProxyAPI endpoint. Its separate official-CLI ACP bridge is not the OAuth proxy path compared here.
- [OmniRoute release/v3.8.55 at fbd3396](https://github.com/cheaper-inference/OmniRoute/tree/fbd339668384803bc3a9d42370fc413a55e013d5): [OAuth configuration](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/constants/oauth.ts), [OAuth provider](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/src/lib/oauth/providers/antigravity.ts), and [project bootstrap](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/antigravityProjectBootstrap.ts). It uses the same five scopes as DurinDoor, production bootstrap, and bounded onboarding when the project is missing. Its bootstrap also distinguishes a completed response without a project as requiring manual project setup; this change fails the sign-in instead of persisting an empty project.

## Reproduced defect

DurinDoor loaded the account project during sign-in but never waited for it. `src/lib/oauth/providers.js` read `cloudaicompanionProject` from the `loadCodeAssist` response, and when that was empty it started `onboardUser` as a fire-and-forget promise that the OAuth callback never awaited. The connection row was written first, with an empty `projectId`, and the background onboarding result was discarded.

The reproduced failures, from `tests/unit/antigravity-flow.test.js` against the pre-fix provider code:

- The saved connection carried `projectId === ""` instead of the onboarded project.
- `onboardUser` was never called when `loadCodeAssist` returned no project, so a cold account could never obtain one through sign-in.
- A failed project lookup and a completed onboarding without a project both returned HTTP 200 and saved a connection anyway.
- A `cloudaicompanionProject` returned as a plain string was stored untrimmed (`" existing-project "`).

## Fixed behavior

`src/lib/oauth/providers.js`, Antigravity `postExchange`:

1. The `loadCodeAssist` call must succeed. A non-2xx response fails the sign-in instead of falling through to an empty project.
2. The project id is read from either shape Google uses — a plain string or an object with an `id` — and is trimmed in both cases.
3. When no project is present, `onboardUser` runs inline and is awaited. `onboardUser` is a long-running operation: a `done:false` answer means the account project is still being provisioned, so the request is re-sent until it settles. Only a `done:true` response carries the project.
4. A settled response without a project fails the sign-in. The connection is not saved, so no row ever carries an empty or placeholder project.

The sign-in poll is bounded and operator-tunable through `ANTIGRAVITY_ONBOARD_MAX_ATTEMPTS` (default 10) and `ANTIGRAVITY_ONBOARD_RETRY_DELAY_MS` (default 5000). These are separate from the `ONBOARD_MAX_ATTEMPTS` / `ONBOARD_RETRY_DELAY_MS` variables used by the runtime project-discovery path (`open-sse/services/projectId.js`), so an operator who already tuned the runtime knobs does not silently shorten the sign-in poll.

### Upstream poll bounds and body field, checked and not changed

- CLIProxyAPI polls `onboardUser` up to 5 times with a 2 s gap (`internal/auth/antigravity/auth.go`, `OnboardUser`). OmniRoute uses the same 5 attempts with a 2 s interval (`open-sse/services/antigravityProjectBootstrap.ts`, `ONBOARD_POLL_MAX_ATTEMPTS` / `ONBOARD_POLL_INTERVAL_MS`). DurinDoor keeps 10 attempts with a 5 s gap, matching the pre-existing loop bound in the same function, and is now configurable. No reproduced failure justifies shortening it.
- CLIProxyAPI and OmniRoute both send the tier as `tier_id`; DurinDoor sends `tierId`. The Cloud Code API is a proto3 JSON service, and proto3 JSON parsing accepts both the original field name and its lowerCamelCase form, so the two spellings address the same field. DurinDoor keeps `tierId` because its runtime discovery path (`open-sse/services/projectId.js`) already sends that spelling; changing one path without the other would split the contract for no gain.

## Headers, models, quota and responses

[CLIProxyAPI's executor](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/antigravity_executor.go) and [OmniRoute's endpoint configuration](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/antigravityUpstream.ts) use daily Cloud Code generation endpoints. DurinDoor's registry and executor do likewise, sending bearer authorization and the configured IDE user agent; its bootstrap uses production Cloud Code. CLIProxyAPI uses separate header profiles for load and onboarding; OmniRoute defines profiles in [antigravityHeaders.ts](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/antigravityHeaders.ts). No header fingerprint changes are included here.

[CLIProxyAPI's model registry](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/models/models.json) contains IDs including `claude-opus-4-6-thinking` and `claude-sonnet-4-6`. [OmniRoute's aliases](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/antigravityModelAliases.ts) map the 3.7 Flash display tiers to `gemini-3.7-flash-tiered`, and 3.1 Pro High to `gemini-pro-agent`. DurinDoor's registry maintains its own aliases and catalog; differences are not changed without a reproduced failure. OmniRoute's [usage service](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/usage/antigravity.ts) queries available-model quota and its weekly quota service adds group data; DurinDoor uses the corresponding available-model and weekly-summary calls in `open-sse/services/usage/google.js`.

For responses, CLIProxyAPI's [Claude translator](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/translator/antigravity/claude/antigravity_claude_response.go) and OmniRoute's [stream collector](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/executors/antigravity/sseCollect.ts) handle Cloud Code response envelopes. The local flow test exercises wrapped candidate text and usage through both public chat formats in JSON and SSE; it does not establish parity for every tool, image, thought, or error response.

## Limits

- No live verification. Every upstream statement comes from reading the pinned upstream trees at the SHAs above. No provider API was called, no credential was used, and no browser or paid API was involved.
- "Upstream signs in with scope X" means "the upstream code contains a path for X", not "sign-in method X currently works against the vendor". Google may accept a different client, scope set, or project tier than the ones compared here.
- The `v3.8.55` OmniRoute tag was not published at the time of reading, so the comparison is pinned to the release-train commit SHA rather than to a tag object.
- The test drives the OAuth route, the local database, the `/v1/models` route, and the OpenAI and Anthropic chat routes with mocked provider HTTP. It does not exercise Google's real token issuance, project provisioning, quota endpoints, or the real `daily-cloudcode-pa.googleapis.com` generation path.

## agy connection and catalog refresh (issue #2034)

At the pinned snapshots, [CLIProxyAPI's Antigravity auth](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/antigravity/auth.go) implements OAuth and project lookup, and its [executor](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/antigravity_executor.go) handles generation. [EasyCLIProxyAPI's management API](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs) delegates OAuth to the core; its deployed core revision is not established by the desktop revision. [OmniRoute's agy registry](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/config/providers/registry/agy/index.ts) identifies a separate agy provider using the Antigravity executor and OAuth client configuration; its [executor](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/executors/antigravity.ts) handles streaming. This change aligns catalog refresh with the same operator-configured client used by the local agy request refresh, consistent with the OmniRoute registry; it does not import upstream credentials.

The synthetic test imports an existing `agy` connection via DurinDoor's legacy `db.json` migration, signs in an `antigravity` account with the same email, forces a catalog 401 and refresh, and sends streaming requests through both provider IDs with a closed outbound mock. It verifies token and project separation. This is a DurinDoor data-file import, not native parsing of an Antigravity CLI auth file; no dedicated CLI auth-file importer was found. It does not establish live provider acceptance, full upstream request parity, or compatibility with arbitrary exported credential formats. Existing project onboarding remains covered separately by `antigravity-flow.test.js`.

## Account-scoped model discovery (#2034, second pass)

Re-read on 2026-11-20 at the revisions below. No provider credential and no account traffic was used, and no provider API was called.

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | `sdk/auth/antigravity_models.go`, read again for this pass. |
| EasyCLIProxyAPI | [`e4223d5eefa22a3301ca7e2a28d05897432b07f9`](https://github.com/router-for-me/EasyCLIProxyAPI/commit/e4223d5eefa22a3301ca7e2a28d05897432b07f9) | `src-tauri/src/management_api.rs`, read again for this pass. |
| OmniRoute | [`fbd339668384803bc3a9d42370fc413a55e013d5`](https://github.com/cheaper-inference/OmniRoute/commit/fbd339668384803bc3a9d42370fc413a55e013d5) | `open-sse/config/antigravityUpstream.ts` and `open-sse/services/usage/antigravity.ts`. |
| DurinDoor | `3565862d76ce1586481459cf8a5c03c488d4f95d` | Base of this change. |

### The defect

Two paths read Cloud Code's available-models RPC, and only one of them scoped the request to the account:

- The quota path (`open-sse/services/usage/google.js`, `getAntigravityUsage`) already sent the account project.
- The dashboard provider-models configuration (`src/app/api/providers/[id]/models/modelsConfig.js`, the `antigravity` entry) posted `body: {}`.

An empty body is not bound to the signed-in account, so the answer was not that account's catalog.

### Upstream contract, checked

[CLIProxyAPI's `sdk/auth/antigravity_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/auth/antigravity_models.go) at `6faa8d20` fixes the parts this change adopts:

- `AntigravityModelBaseURLDaily` is `https://daily-cloudcode-pa.googleapis.com` and `AntigravityModelsPath` is `/v1internal:fetchAvailableModels`. `FetchAntigravityAvailableModels` posts `{"project": "<trimmed project>"}` with `Content-Type: application/json`, `Authorization: Bearer <token>` and the Antigravity user agent.
- `AntigravityProbeStatus` separates success, `AntigravityProbeStatusAuthError` (401 and 403) and `AntigravityProbeStatusTransientError` (any other non-2xx, an unreadable body, a malformed payload, or a transport error).
- `ParseAntigravityModelCapabilityHints` treats an absent `models` object as unknown and `{}` as an authoritative empty catalog, and `BuildPersistedAntigravityCapabilityHints` refuses to persist an unknown catalog as an empty authoritative set.

[OmniRoute's usage fetcher](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/services/usage/antigravity.ts) (`fetchAntigravityAvailableModelsCached`) sends the same body shape, `JSON.stringify(projectId ? { project: projectId } : {})`, and caches per access token and project. [Its endpoint list](https://github.com/cheaper-inference/OmniRoute/blob/fbd339668384803bc3a9d42370fc413a55e013d5/open-sse/config/antigravityUpstream.ts) keeps `daily-cloudcode-pa.googleapis.com` first for discovery and adds the production and sandbox hosts as fallbacks.

[EasyCLIProxyAPI's `src-tauri/src/management_api.rs`](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs) at `e4223d5e` delegates every OAuth and credential call to the CLIProxyAPI core over `/v8/management/...`; `normalize_management_oauth_provider` maps `anti-gravity` to `antigravity` and `management_oauth_uses_webui_callback` lists it. It has no Antigravity model discovery of its own, so there is nothing to port from it beyond the delegation.

### What changed

`open-sse/services/antigravityCatalog.js` (new) holds the contract: the pinned URL, the project resolution, the request body, the status classifier and the payload parser.

- The project comes from the connection, validated by the shared `normalizeCloudCodeProjectId` (`open-sse/services/usage/shared.js`) — the same validator the quota path uses. It accepts the plain string and the `{ id }` object shapes Google uses and trims both. A value in any other shape is not a project.
- The body is `{ "project": "<id>" }` when the connection has a valid project, and `{}` when it does not. An unusable value is omitted rather than sent as a placeholder.
- `classifyAntigravityCatalogStatus` maps 401 and 403 to `auth_error` and every other non-2xx to `transient`.

`src/app/api/providers/[id]/models/modelsConfig.js` keeps the `antigravity` entry declarative — the same URL, method, Hub headers and public capability filters — and adds `buildBody` and `classifyStatus`.

`src/app/api/providers/[id]/models/fetchConnectionModels.js` gained three provider-agnostic hooks:

- `buildBody(token, connection)` builds a per-connection request body, mirroring the existing `buildHeaders` hook.
- A `parseResponse` that returns `null` means "this payload is not a catalog". That is reported as a 502 transient failure instead of an empty list, so a known catalog is not replaced by nothing. This also removes the old parser's behaviour of turning a string `models` field into one-character model rows.
- `classifyStatus(httpStatus)` attaches a `classification` to a failed result. `GET /api/providers/[id]/models` passes it through; providers without the hook keep their previous result shape.

The route now forwards the incoming request's abort signal, so a client that goes away does not leave a probe running.

The endpoint stays on the daily host that the existing catalog contract and the live-catalog evidence already pin. The quota path's production host is a different call and was not changed.

### Preserved behaviour

- Per-account isolation: each connection resolves its own project, so two accounts never read each other's catalog.
- The strict proxy rules, the connection proxy resolution and the guarded outbound dispatcher are unchanged; the probe still goes through `proxyAwareFetch`.
- The Hub identity (user agent, `X-Client-Name`, `X-Client-Version`) is unchanged.
- The discovered public capability filters (internal, `-disabled` and `tab_` rows) are unchanged.
- The per-tier quota semantics in `open-sse/services/usage/google.js` are untouched, including the free-tier rule that skips the per-model rows.
- The existing fallback rules are untouched: the auto-sync runner keeps the previous catalog on a failed attempt and on an empty list, and the dashboard keeps the static registry catalog when no live catalog is available.
- The Antigravity deprecation decision is untouched.

### Capability-hint persistence: not applicable in this base

Upstream persists the probed model ids per account in credential metadata under `antigravity_capability_hints`, bound to the project id and the sanitized endpoint, and refuses to persist an unknown catalog. DurinDoor does not, and this change does not add it, because no existing durable per-connection store can hold the hints as they are shaped:

- The only durable per-connection store is `providerSpecificData` on the connection row. Its transfer contract (`TRANSFER_SAFE_PSD_FIELDS` and the scalar check in `src/lib/db/index.js`) rejects a nested hints object, so storing one would change the provider transfer surface, not just add a field.
- The synced model catalog (`src/lib/db/repos/syncedModelsRepo.js`) is keyed by provider id, not by connection. Reusing it for per-account hints would let one account's catalog be served to another.
- There is no reader for restored hints. The runtime catalog comes from the provider registry and the provider-level synced catalog, and the dashboard reads live catalogs per connection.

Adding a durable store for hints would therefore be a schema and transfer change with a new write path next to the credential refresh, which is where the stale-credentials write race the work order names would appear. That is out of scope here and is recorded as a limitation rather than attempted.

### HTTP/1.1 without ALPN: recorded, not changed

Upstream pins its probe transport to HTTP/1.1 with no ALPN extension (`configureAntigravityHTTP11Transport` clears `Protocols` and `ForceAttemptHTTP2`, wipes `TLSNextProto` and sets `NextProtos` to nil) because the native Antigravity client sends no ALPN extension.

DurinDoor's probe goes through the shared `proxyAwareFetch` transport, which is an undici agent shared by every provider request. Undici negotiates HTTP/1.1, but it does send an ALPN extension, so the wire shape differs from upstream's. The shared transport was left intact: no closed runtime fixture showed a local compatibility failure caused by protocol selection, and changing a shared transport would put the proxy and quota boundaries of every provider at risk for a difference that has not been shown to matter against the vendor. The delta is recorded here so a future provider-specific transport can be justified by evidence rather than by this note.

### Validation scope

`tests/unit/antigravity-project-catalog.test.js` drives the real `GET /api/providers/[id]/models` route against a closed outbound mock with two synthetic signed-in connections, and asserts the pinned endpoint, each account's own project and bearer, the Hub identity, the omitted invalid project, the auth/transient classification, the malformed-payload rejection, and that a failed probe leaves the known catalog in place. `tests/unit/antigravity-live-catalog.test.js` and `tests/unit/antigravity-flow.test.js` are unchanged and still pass.

These are local wiring tests. They do not establish that Google accepts this body for a given account, that the account's project is the one Google would use, that the daily host answers for every account, or that the catalog is the complete set of usable models.


## CLIProxyAPI delta through 6960763 (#2034)

Compared `f5c5681a8361c9da53e93c60b6507816eee7468b..6960763455c4ac3d4828fb1736aa5de2183ccecf` in `router-for-me/CLIProxyAPI`, including `internal/auth/antigravity/auth.go`, `internal/runtime/executor/antigravity_executor*.go`, `sdk/auth/antigravity_models.go`, `sdk/cliproxy/antigravity_models.go`, and `internal/translator/antigravity/`. This is a source comparison with synthetic HTTP only.

- Auth reads: upstream caps successful project responses at 1 MiB and bounds error bodies. The sign-in path now bounds successful load and onboarding JSON to 1 MiB and 30 seconds. It already rejects non-success project responses without reading their bodies. User info and token exchange retain their existing read behavior; this change does not claim a bound on those calls.
- Onboarding: both implementations poll and fail when no project is returned. The existing `antigravity-flow.test.js` covers successful polling, exhaustion, and failure without saving. Upstream also propagates cancellation into its request and poll delay; that delta is ported. The OAuth route forwards the incoming request signal through `exchangeAndSaveAuthorizationCode` and `exchangeTokens` as a trailing argument to `provider.postExchange` (other providers ignore it). Antigravity passes it to the user-info, project-lookup and onboarding requests and makes the poll delay abortable. An abort stops immediately, sends no further request, saves nothing and rejects with `OAUTH_CANCELLED` (HTTP 499), which is distinct from a project failure. `tests/unit/antigravity-oauth-cancellation.test.js` covers abort before the exchange, during the onboarding request, during a poll delay, and unchanged completion with synthetic fixtures. Upstream's classification of operation errors is not ported.
- Refresh and validation: Antigravity reloads the selected connection inside a per-connection refresh flight, shares its result, and persists with the existing credential compare-and-swap guard. A newer stored credential supersedes the request snapshot. Project discovery HTTP and missing-project failures are classified for the selected connection; transport failures remain transient. Project cache entries are bound to the presented credential. `antigravity-refresh-serialization.test.js` covers concurrency, stale snapshots, account isolation, project validation, and redirect rejection. This coordination is process-local.
- Retry-After: `AntigravityExecutor.computeRetryDelay` handles short retries. Routing persists per-connection model cooldowns using upstream reset evidence when available, with Antigravity defaults for rate limits and exhausted quota. Exhausted credits cool the connection across models and are not reduced to a locally synthesized short delay. `antigravity-refresh-serialization.test.js` exercises account selection and recovery with fake timers. Other providers retain their existing policy.
- Catalog: account project scoping, auth/transient classification and unknown catalog handling are documented above and covered by `antigravity-project-catalog.test.js`. Upstream's persisted capability hints and transport fingerprint remain unported for the reasons above. Catalog identities and shared routing were not changed.
- SSE and signatures: existing terminal tests cover completion without EOF, late usage and bounded draining; `antigravity-thought-signature-family.test.js` covers signature family isolation. Upstream's Gemini native response restoration and multi-candidate defaults use a different translator contract; they were not copied without a matching local live-path regression. The new bounded-read fixture does not establish complete translator parity.
