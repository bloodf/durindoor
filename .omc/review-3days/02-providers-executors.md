# Provider / Executor / Config Review — 3-day window

Range: `cfb25e641..origin/dev`  
Scope: `open-sse/providers/**`, `open-sse/executors/**`, `open-sse/config/**`, `open-sse/services/**` + relevant unit tests.  
Excluded: `docs/`, `gitbook/`, `src/app/api/**`, `src/sse/handlers/**`, `open-sse/translator/**`.

Patch files saved to:
- `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/review-3days/providers.patch` (providers + services + config)
- `/home/cortexos/Developer/github.com/bloodf/durindoor/.omc/review-3days/executors.patch` (executors)

## Findings

### P0

1. **Codex `_isCompact` is read before it is set**  
   `open-sse/executors/codex.js:211` (`buildUrl`) reads `this._isCompact`; `open-sse/executors/base.js:139` calls `buildUrl` **before** `transformRequest`. `this._isCompact` is only assigned in `transformRequest` at `open-sse/executors/codex.js:381`.  
   **Failing scenario:** On a shared executor instance, `/compact` URL is used for the wrong request, or stale `_isCompact` from a prior request leaks into the next request.  
   **Fix:** Move the compact flag decision into `buildUrl` from the current `body` or `args` directly, instead of storing it as instance state.

2. **Codex SSE peek matches transient/error substrings before confirming user output**  
   `open-sse/executors/codex.js:303-308`. The peek loop checks `CODEX_SSE_RETRY_PATTERNS` / `CODEX_SSE_ACCOUNT_FALLBACK_PATTERNS` before it checks `CODEX_SSE_USER_OUTPUT_PATTERNS`.  
   **Failing scenario:** First assistant output contains text like "The selected model is at capacity..." or "server_is_overloaded" in a code block / explanation; the code treats the stream as a synthetic 503 and aborts the valid response.  
   **Fix:** Check user-output markers first, or restrict retry-pattern matching to `event: error` lines.

3. **VeoAIFree concrete executor exists but is shadowed by UnsupportedOmniRouteWebSessionExecutor**  
   `open-sse/executors/veoaifree-web.js:151` implements a real `VeoAIFreeWebExecutor`, but `open-sse/executors/index.js:93-103` maps `veoaifree-web` (and aliases) to `UnsupportedOmniRouteWebSessionExecutor` because `open-sse/executors/unsupported-websession.js:76` still lists it in `BLOCKED_OMNIROUTE_PROVIDERS`.  
   **Failing scenario:** Video generation requests to `veoaifree-web` return 501 `provider_port_pending` even though the executor is ready.  
   **Fix:** Remove `veoaifree-web` from `BLOCKED_OMNIROUTE_PROVIDERS` and register the real executor in `executors`.

4. **Zenmux Free ctoken leaks in returned URL and error payloads**  
   `open-sse/executors/zenmux-free.js:277` sets `ctoken` as a URL query parameter; `open-sse/executors/zenmux-free.js:296-360` returns `url.toString()` in every success and error result (e.g., `502`, `401`, `402`). The same `url` string is logged through `chatCore`/`executorProxy`.  
   **Failing scenario:** Cookie token appears in logs, error responses, and any downstream telemetry that captures `result.url`.  
   **Fix:** Return a redacted URL (strip `ctoken` from the query string) in `result.url` while still sending the full URL to `proxyAwareFetch`.

5. **Zenmux Free cookie parsing throws `URIError` instead of 401**  
   `open-sse/executors/zenmux-free.js:22` calls `decodeURIComponent(match[1])` outside any try/catch.  
   **Failing scenario:** A malformed `ctoken` cookie with an invalid percent-encoding causes an unhandled `URIError` instead of the intended "cookies not found" 401.  
   **Fix:** Wrap `decodeURIComponent` in a try/catch and return `""` on failure.

6. **Pollinations keyless catalog is not recognized as a no-auth provider**  
   `open-sse/providers/registry/pollinations.js:17` sets `category: "apikey"` and has no `noAuth: true`. The auth credential path only injects a public no-auth credential when `FREE_PROVIDERS[providerId]?.noAuth` is true (`src/sse/services/auth.js:61`).  
   **Failing scenario:** A user with no saved Pollinations connection sends a keyless request; credentials resolve to `null`, so the request fails authentication even though the upstream free catalog is intended to work without a key. Confirmed by `tests/__baseline__/known-fails.txt:62-64` (`pollinations-auth-credentials.test.js`).  
   **Fix:** Add `noAuth: true` to the registry entry (it can still prefer a saved `apiKey` when present) or set `category: "free"`.

7. **Kiro region resolver ignores `profileArn` when no explicit `region` is set**  
   `open-sse/executors/kiro.js:53-64` calls `getOrderedBaseUrls(credentials)` and only uses `credentials?.providerSpecificData?.region` for `region`; it does not extract the region from `profileArn`. `open-sse/config/kiroConstants.js:21-22` has a `resolveKiroRegion` shim that *does* handle `profileArn`, but `open-sse/executors/kiro.js:9` imports the bare `resolveKiroRegion` from `kiroRegions.js` and never calls it.  
   **Failing scenario:** IdC account with a `profileArn` homed in `eu-central-1` but no explicit `providerSpecificData.region` is routed to the hardcoded `us-east-1` endpoints; Kiro rejects the token with 403/400. Confirmed by `tests/__baseline__/known-fails.txt:19-26` (kiro-profile-arn-regional tests).  
   **Fix:** In `getOrderedBaseUrls`, derive the region from `credentials` via `resolveKiroRegion(credentials)` (or align the region from `profileArn`) before regionalizing the base URLs.

8. **Kiro SSE parser has unbounded buffer growth and silent frame-count truncation**  
   `open-sse/executors/kiro.js:≈160-180` (EventStream buffer append/slice) and `maxIterations = 1000` loop. A malicious or slow upstream that never emits a complete frame can grow the buffer without bound; a single chunk with >1000 frames silently stops parsing mid-frame.  
   **Failing scenario:** Long-running streaming request memory exhaustion, or truncated response with missing trailing events.  
   **Fix:** Cap buffer size and abort on overflow; guard against frame-count truncation by parsing until buffer exhaustion rather than an arbitrary iteration limit.

9. **Pollinations `buildUrl` fallback duplicates the registry URL and ignores changes**  
   `open-sse/executors/pollinations.js:12` hardcodes `"https://gen.pollinations.ai/v1/chat/completions"` as a fallback. `open-sse/providers/registry/pollinations.js:19-20` also stores both `baseUrl` and `baseUrls` with the same endpoint.  
   **Failing scenario:** If the registry URL changes, the executor fallback still sends to the old URL.  
   **Fix:** Use `this.config.baseUrl || this.config.baseUrls[0]` from the registry; remove the redundant `baseUrl` field.

10. **CLIProxyAPI URL resolution silently falls back to `127.0.0.1:8317` on settings import failure**  
    `open-sse/executors/cliproxyapi.js:15-23` dynamically imports `@/lib/localDb` and catches any failure, falling back to `env`/`DEFAULT_HOST:DEFAULT_PORT`. In a standalone Node runtime without the alias, misconfigurations go undetected.  
    **Failing scenario:** User sets `CLIPROXYAPI_URL` but the import fails for an unrelated reason; the sidecar is silently targeted at `127.0.0.1:8317` and the connection fails with no actionable log.  
    **Fix:** Log a warning when the settings import fails or when falling back to the default host.

11. **Antigravity `AG_DEFAULT_TOOLS` Set is missing `mcp_sequential-thinking_sequentialthinking`**  
    `open-sse/executors/antigravity.js:515-563` includes that name in `AG_DECOY_TOOLS`, but `open-sse/config/appConstants.js:108-130` does not include it in `AG_DEFAULT_TOOLS`. `open-sse/executors/antigravity.js:436,446,472,483` uses `AG_DEFAULT_TOOLS` to decide whether to preserve native AG names.  
    **Failing scenario:** A real AG response containing `mcp_sequential-thinking_sequentialthinking` will be incorrectly renamed with `_ide` suffix, breaking the tool round-trip.  
    **Fix:** Add the missing native name to `AG_DEFAULT_TOOLS`.

### P1

12. **Codex `body.include` is clobbered when reasoning is enabled**  
    `open-sse/executors/codex.js:445-446` assigns `body.include = ["reasoning.encrypted_content"]` whenever `reasoning.effort !== 'none'`, discarding any caller-provided include values.  
    **Failing scenario:** Clients requesting additional Responses API include values (e.g., `web_search_call.action.sources`) lose them on the wire.  
    **Fix:** Merge/dedupe include values instead of overwriting.

13. **Codex usage dispatcher omits `providerSpecificData`**  
    `open-sse/services/usage.js:37` calls `getCodexUsage(c.accessToken, c.proxyOptions)`, but `getCodexUsage` accepts `providerSpecificData` as the second argument and uses it for `ChatGPT-Account-ID` (`open-sse/services/usage/codex.js:40-63`).  
    **Failing scenario:** Multi-workspace Codex users see usage for the wrong account because the account header is missing.  
    **Fix:** Pass `c.providerSpecificData` to `getCodexUsage` (or fix the dispatcher signature to match the function).

14. **Antigravity `cloakTools` dead code keeps tool name renaming logic that can never run**  
    `open-sse/executors/antigravity.js:418-514` defines `static cloakTools()` and `AG_DECOY_TOOLS`, but no caller uses it (the real transform path is in `transformRequest` at `open-sse/executors/antigravity.js:216-238`). The dead code re-implements tool merging and name mangling with no response-side uncloak.  
    **Failing scenario:** If `cloakTools` is ever enabled, function names would be suffixed but responses would not reverse them, breaking tool calls.  
    **Fix:** Delete `cloakTools` / `AG_DECOY_TOOLS` or wire them with a complete uncloak path and tests.

15. **MiMo Free JWT cache is written before expiry is validated**  
    `open-sse/executors/mimo-free.js:61-78` writes `cachedJwt = data.jwt` immediately and only derives `jwtExpiresAt` from the payload. If the returned JWT lacks an `exp` claim, the fallback TTL is used, but a malformed JWT (e.g., empty string or non-JWT shape) is still cached.  
    **Failing scenario:** After a bad bootstrap response, all subsequent requests use the cached bad JWT until process restart.  
    **Fix:** Validate `data.jwt` shape and reject/throw before caching; reset cache on parse failure.

16. **Chipotle client pool reuses stale pooled WebSockets**  
    `open-sse/executors/chipotle.js:233-244` (`getClient`) pops a pooled `AmeliaClient` without checking whether its underlying WebSocket is still open. `open-sse/executors/chipotle.js:250-253` (`releaseClient`) pushes it back. If the server closes the connection between uses, the next request starts with `stompConnected=true` and `sendSockJS` fails.  
    **Failing scenario:** Intermittent "WebSocket not open" errors on reused Chipotle connections.  
    **Fix:** Verify `client.ws?.readyState === WebSocket.OPEN` before reuse; evict closed clients from the pool.

17. **WebSession utilities abort-signal merge leaks listeners**  
    `open-sse/executors/websession-utils.js:13-25` (`mergeAbortSignals`) adds `'abort'` listeners to every input signal but never removes them if the composite signal is never aborted.  
    **Failing scenario:** Long-running streaming sessions accumulate uncollected listeners and memory.  
    **Fix:** Store listener references and remove them when the composite signal is aborted or garbage-collected; prefer `AbortSignal.any` when available.

18. **GitLab Duo registry `oauth.defaultBaseUrl` ignores self-managed instances**  
    `open-sse/providers/registry/gitlab-duo.js:26` hardcodes `oauth.defaultBaseUrl: "https://gitlab.com"`. `open-sse/executors/gitlab.js:82` (`resolveGitLabBase`) falls back to `process.env.GITLAB_DUO_BASE_URL`, but the registry OAuth block does not.  
    **Failing scenario:** Self-managed GitLab Duo users without a connection `baseUrl` still get authorization URLs pointing to `gitlab.com`. Confirmed by `tests/__baseline__/known-fails.txt:55` (`tests/unit/gitlab-duo-registry.test.js`).  
    **Fix:** Read `process.env.GITLAB_DUO_BASE_URL` for `oauth.defaultBaseUrl` when no connection baseUrl is set.

19. **Kiro `kiroConstants.js` now imports the full OAuth registry on the SSE hot path**  
    `open-sse/config/kiroConstants.js:3` imports `assertValidAwsRegion` from `src/lib/oauth/constants/oauth.js`; that module imports `open-sse/providers/index.js`, which loads the entire provider registry. This bloats every Kiro request's dependency graph and couples request shaping to the full registry build.  
    **Failing scenario:** Slower cold starts and larger runtime surface for Kiro executor/translators.  
    **Fix:** Move `assertValidAwsRegion` or a minimal region regex into `open-sse/config/kiroRegions.js` (already dependency-free).

20. **Antigravity `buildIdeRequestId` fingerprints the same IDE identity for the CLI alias (`agy`)**  
    `open-sse/providers/registry/agy.js:8` spreads `antigravity.transport` (including the IDE User-Agent), and `open-sse/executors/antigravity.js:115-130` builds request IDs with `antigravity:conversation` seeds. The `agy` provider is therefore indistinguishable from IDE traffic on the wire.  
    **Failing scenario:** If the CLI is meant to have a distinct traffic signature, the alias provides no real separation.  
    **Fix:** Give `agy` a distinct `User-Agent` and request-id namespace, or remove the alias if it is meant to be identical.

21. **Kiro static registry models duplicate dynamic expansion from `resolveKiroModels`**  
    `open-sse/providers/registry/kiro.js:42-58` adds static variants like `claude-opus-4.8-thinking` and `claude-opus-4.8-agentic`. `open-sse/services/kiroModels.js` dynamically expands every upstream model into the same four variants.  
    **Failing scenario:** `/v1/models` lists the same Kiro model IDs twice (static + dynamic).  
    **Fix:** Keep only base models in the registry and let `resolveKiroModels` produce the variants.

22. **No-auth `getProviderCredentials` fallback for excluded/locked real keys is new behavior**  
    `src/sse/services/auth.js:137-148` (added in window) falls back to the public no-auth credential for a no-auth provider when the only saved connection is excluded or locked. This is intentional for Pollinations, but it means an excluded premium-key connection silently falls back to the free catalog, potentially surprising the user. Confirmed by `tests/__baseline__/known-fails.txt:62-64` (`pollinations-auth-credentials.test.js`).  
    **Failing scenario:** User rotates a bad premium key, excludes it; subsequent requests use the public keyless tier instead of failing.  
    **Fix:** Document the fallback or make it opt-in per provider.

23. **CommandCode registry has duplicate entries for `commandcode` and `command-code`**  
    `open-sse/providers/registry/commandcode.js` and `open-sse/providers/registry/command-code.js` both exist with overlapping model lists but different `x-command-code-version` headers (`0.25.7` vs `0.33.2`). Only one is used by the executor (`open-sse/executors/commandcode.js:19` defaults to `"commandcode"`).  
    **Failing scenario:** Users connecting to the `command-code` alias get stale headers from `commandcode` registry; the executor never uses the alias entry.  
    **Fix:** Unify the registries or make the executor resolve the provider alias to the correct registry entry.

24. **Antigravity registry lost the sandbox fallback URL**  
    `open-sse/providers/registry/antigravity.js:22` now has only `baseUrls: [ANTIGRAVITY_IDE_BASE_URL]`. Prior version had `[daily-cloudcode-pa.googleapis.com, daily-cloudcode-pa.sandbox.googleapis.com]`.  
    **Failing scenario:** If the primary production endpoint is rate-limited or down, no fallback endpoint remains.  
    **Fix:** Restore the sandbox fallback or add a registry-level retry fallback list.

25. **Antigravity `uuidFromSeed` deterministically hashes potentially PII-bearing seeds** `[INFERENCE]`  
    `open-sse/executors/antigravity.js:100-110` derives request IDs from `crypto.createHash('sha256')` over `sessionId`/`email`/`connectionId`.  
    **Failing scenario:** Request IDs may be reversible to user/session material, especially for low-entropy seeds.  
    **Fix:** Use `crypto.randomUUID()` per request, or use a keyed HMAC with a secret key if determinism is required.

26. **Codex `buildHeaders` sets `session_id` from stale instance state**  
    `open-sse/executors/codex.js:207` reads `this._currentSessionId`; `transformRequest` at `open-sse/executors/codex.js:384` sets it, but `buildHeaders` runs after `transformRequest` in `BaseExecutor`. While correct for a single request, instance state is not reset on entry; a failed request can leave a stale `_currentSessionId` for the next caller.  
    **Failing scenario:** Concurrent or retried requests may share/carry the wrong session id.  
    **Fix:** Compute `session_id` from the current request body/credentials inside `buildHeaders`, not from instance state.

27. **VeoAIFree `fetchWithTimeout` duplicates `websession-utils` logic and uses non-standard abort error**  
    `open-sse/executors/veoaifree-web.js:16-43` defines its own `withTimeout`/`fetchWithTimeout` instead of using `open-sse/executors/websession-utils.js:33-53`. Its timeout path rejects with a plain `Error` instead of the expected `AbortError`/`TimeoutError`, so callers that check `error.name` for retry logic will miss it.  
    **Failing scenario:** Timeout on VeoAIFree requests is not handled by the standard retry/fallback pipeline.  
    **Fix:** Import `fetchWithTimeout` from `websession-utils` and reject with an `AbortError` on timeout.

28. **VeoAIFree blocked test asserts the wrong behavior**  
    `tests/unit/omniroute-websession-blocked.test.js:82-91` expects `veoaifree-web` to be blocked and return 501, but `tests/unit/omniroute-websession-runtime.test.js:146-160` expects the concrete video executor to be used.  
    **Failing scenario:** These tests contradict each other; one of them must be updated when the blocked list is fixed.  
    **Fix:** Remove the blocked assertion for `veoaifree-web` and enable the executor.

29. **API-key policy allows CLI requests to bypass all policy enforcement**  
    `src/sse/services/apiKeyPolicy.js:16-20` returns `null` (allow) when `hasValidCliToken` is true, skipping model allowlist and token/cost limits. This is intended for internal dashboard/CLI requests, but it is a broad bypass.  
    **Failing scenario:** Any request bearing a valid `x-9r-cli-token` ignores the API key's configured policy.  
    **Fix:** Document the bypass and ensure it is only used for internal endpoints.

### P2

30. **Zenmux Free `authType` duplicated at root and transport**  
    `open-sse/providers/registry/zenmux-free.js:14` and `open-sse/providers/registry/zenmux-free.js:20` both set `authType: "cookie"`.  
    **Failing scenario:** A credential manager that reads the top-level `authType` decides cookie auth is required, while the transport layer reads `transport.authType`; if they later diverge, the same provider would be treated as two different auth types and the UI may show conflicting connection prompts.  
    **Fix:** Remove the duplicate and document the canonical location.

31. **Kiro `buildKiroProfileEndpoint` may return `https://undefined` when no amazonaws host is available** `[INFERENCE]`  
    `open-sse/config/kiroRegions.js:75-81` returns `https://${amazonHost}` where `amazonHost` is the first `includes('amazonaws.com')` host. If `KIRO_RUNTIME_HOSTS` is ever edited to exclude amazonaws hosts for a region, `amazonHost` is `undefined` and the result is `https://undefined`.  
    **Failing scenario:** Future configuration change produces invalid control-plane URLs.  
    **Fix:** Guard with a fallback to `q.${region}.amazonaws.com` or throw on missing host.

32. **Codex `_peekSseTransientError` re-reads the same body twice when no error is matched** `[INFERENCE]`  
    `open-sse/executors/codex.js:318-333` reads the prefix chunks, then creates a `ReadableStream` that re-reads the remaining upstream body. If `response.body` is a BYOB reader or the environment has `getReader()` already locked, the prefix read may consume the only reader.  
    **Failing scenario:** In some runtime environments, the re-assembly stream may not be able to read the body after the prefix peek.  
    **Fix:** Tee the stream before reading, or rely on `response.clone()` for the peek.

## Baseline cross-references

- `tests/__baseline__/known-fails.txt:19-26` — kiro-profile-arn-regional tests (region/profileArn routing).
- `tests/__baseline__/known-fails.txt:54` — `command-code-validation.test.js` (registry alias mismatch).
- `tests/__baseline__/known-fails.txt:55` — `gitlab-duo-registry.test.js` (self-managed base URL).
- `tests/__baseline__/known-fails.txt:62-64` — `pollinations-auth-credentials.test.js` / `pollinations-validate-premium-key.test.js` (no-auth + premium key paths).
- `tests/__baseline__/known-fails.txt:12-13` — `codex-refresh-token.test.js` (credential refresh).

## Bug summary table

| Severity | Count | Key themes |
|---|---|---|
| P0 | 11 | Wrong URL ordering, leaked credentials, shadowed executors, auth misclassification, regional routing, stale instance state, SSE misclassification |
| P1 | 18 | Memory leaks, stale pools, dead code, duplicated config, missing fallbacks, wrong dispatcher args, JWT cache, policy bypass, registry drift |
| P2 | 3 | Duplicate authType, profile endpoint guard, SSE body re-assembly |

## Source artifacts

- `open-sse/executors/antigravity.js:100-130, 211-238, 418-514, 515-563`
- `open-sse/config/appConstants.js:108-130`
- `open-sse/providers/registry/antigravity.js:22`
- `open-sse/providers/registry/agy.js:8-10`
- `open-sse/executors/codex.js:200-223, 235-240, 289-333, 381-390, 445-446, 360-460`
- `open-sse/executors/base.js:134-148`
- `open-sse/services/usage.js:37`
- `open-sse/services/usage/codex.js:40-63`
- `open-sse/executors/kiro.js:9, 53-64`
- `open-sse/config/kiroConstants.js:3, 21-22, 75-118`
- `open-sse/config/kiroRegions.js:49-81`
- `open-sse/executors/cliproxyapi.js:15-23`
- `open-sse/executors/commandcode.js:19-36`
- `open-sse/providers/registry/commandcode.js:1-55`
- `open-sse/providers/registry/command-code.js:1-47`
- `open-sse/executors/chipotle.js:233-253, 294-310`
- `open-sse/executors/websession-utils.js:13-25, 33-57`
- `open-sse/executors/veoaifree-web.js:16-43, 151`
- `open-sse/executors/unsupported-websession.js:76-103`
- `open-sse/executors/index.js:93-103`
- `open-sse/executors/mimo-free.js:61-78, 140-148`
- `open-sse/executors/pollinations.js:12`
- `open-sse/providers/registry/pollinations.js:17, 19-20`
- `open-sse/executors/zenmux-free.js:12-31, 270-363`
- `open-sse/providers/registry/zenmux-free.js:14, 20`
- `open-sse/providers/registry/gitlab-duo.js:15-26`
- `open-sse/executors/gitlab.js:82-84`
- `open-sse/providers/registry/gitlawb-gmi.js:14`
- `src/sse/services/auth.js:61-148`
- `src/sse/services/apiKeyPolicy.js:1-120`
- `tests/__baseline__/known-fails.txt:19-26, 54, 55, 62-64`
- `tests/unit/build-models-list-noauth.test.js:36-74`
- `tests/unit/pollinations-auth-credentials.test.js:23-64`
- `tests/unit/pollinations-validate-premium-key.test.js:35`
- `tests/unit/omniroute-websession-blocked.test.js:82-91`
- `tests/unit/omniroute-websession-runtime.test.js:146-160`
- `tests/unit/command-code-validation.test.js:35-64`
- `tests/unit/gitlab-duo-registry.test.js:35-64`
- `tests/unit/kiro-profile-arn-regional.test.js:1-80`
- `tests/unit/codex-refresh-token.test.js:1-80`
