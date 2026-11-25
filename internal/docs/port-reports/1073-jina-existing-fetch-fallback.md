# #1073: Jina existing fetch fallback

## OmniRoute #18455 — existing local behavior for 402; no runtime port

Source: https://github.com/cheaper-inference/OmniRoute/pull/18455 (merged; pinned final head `4259f54dc7b0926e07db8447c211c5e8f3f4e5a5`, merge commit `e8745419a5b0ad8f525b5344b06df1b8a53d73b2`).

### What the source changed

The source's `src/app/api/v1/web/fetch/route.ts` kept a per-provider allow-list (`QUOTA_STATUS_PROVIDERS`) that decided whether an upstream 402/403 meant "try the next provider". Jina Reader was not in it, so automatic selection stopped at Jina HTTP 402 (insufficient balance). The fix adds one line: Jina 402 is retryable; Jina 403 (and 401) remain authorization failures, and an explicit provider is never replaced. Its tests cover Firecrawl 403, Jina 402, Tavily 200; Jina 401/403; explicit Jina 402; and an exhausted pool.

### Local call path

`POST /v1/web/fetch` (`src/app/api/v1/web/fetch/route.js`) calls `handleFetch` in `src/sse/handlers/fetch.js`.

- No provider/model given: `resolveMediaRoute("webFetch")` returns the dashboard route (or the connected candidates) and `handleComboChat` walks it in strict order (`defaultRouteComboOptions`: `fallback`, no rotation). A named combo takes the same combo path with its own strategy.
- An explicit provider or `<provider>/fetch` goes straight to `handleSingleProviderFetch`, with no combo.
- `handleSingleProviderFetch` loops over that provider's accounts: `getProviderCredentialsWithQuotaPreflight`, `handleFetchCore`, then `markAccountUnavailable` for a failed attempt. It excludes the failed account and asks for another; with none left it returns the failing status.
- `open-sse/handlers/fetch/index.js` `runJina` returns the upstream status and the first 500 characters of the body unchanged.
- `handleComboChat` (`open-sse/services/combo.js`) feeds the response status to `checkFallbackError` (`open-sse/services/accountFallback.js`, rules in `open-sse/config/errorConfig.js`).

### Disposition

**402: already present, nothing to port.** The local classifier is not per-provider for fetch. `errorConfig.js` has a status rule `{ status: 402, cooldownMs: COOLDOWN.long, terminal: true }`, so a Jina 402 gives `shouldFallback: true, terminal: true`, both at the account level and for the combo loop. The result is the Firecrawl 403 -> Jina 402 -> Tavily 200 chain the source reports as broken. There is no `QUOTA_STATUS_PROVIDERS` equivalent to extend, so the source's one-line change has no counterpart here. Adding a Jina-specific 402 exception would be redundant and would add a second classification path.

**Explicit provider: preserved, unchanged.** An explicit `provider`/`model` skips the combo. A Jina 402, 401 or 403 comes back with its own status and no other provider is dialled.

**Credential routing and accounting: preserved, unchanged.** The 402 account is marked via `markAccountUnavailable(..., { webFetch: true })`, which writes only the `webfetch:<provider>` scope (`open-sse/services/fallbackScope.js`), so chat health for the same connection is untouched. The failed account is excluded for the rest of the request and is not re-dialled. A failed attempt records no usage; only the provider that serves the response records one. Combo members without a saved account are not dialled.

**Divergence on 401/403 in the default route (documented, not changed).** The source says automatic selection must stop on Jina 401/403. Locally, `errorConfig.js` gives 401 and 403 long-cooldown rotation like any other provider, so the default route and named combos move to the next member after a Jina 401/403, and a sole Jina member surfaces its own 401/403. This is existing fork behavior shared by every fetch provider. It does not hide the failure from the account (the account is still marked), and it was not changed here: stopping on auth failures for one provider would add a provider-specific mode and alter established rotation. An explicit provider still returns the 401/403.

**No new provider-selection mode, no guard changed.** The URL guard (`assertPublicUrlResolved`, `assertOutboundUrlAllowed`, DNS-pinned `guardedProbeFetch`), API-key admission and policy, the per-key combo ACL, and the stored credentials are not touched. The source's changelog fragment has no counterpart in this repository and was not carried over. The stale-balance display is out of scope in the source and here.

### Evidence

`tests/unit/omni-jina-existing-fetch-fallback.test.js` runs the real `handleFetch`, `handleComboChat`, `handleFetchCore`/`runJina` and `checkFallbackError`. It stubs only the network (`guardedProbeFetch`), the database, credential selection, usage recording and the media-route candidate list. `markAccountUnavailable` delegates to the real classifier. It asserts:

- Positive: the default route Firecrawl 403 -> Jina 402 -> Tavily 200; a configured combo; the failed Jina account marked once with 402 and not re-dialled; usage recorded only for the serving provider; a Jina 200 stops the chain.
- Negative: explicit `provider` and `model: "jina-reader/fetch"` with 402; explicit 401 and 403; a sole Jina 402 returns 402 with no usage; a sole Jina 401/403 returns its own status; the route never adds a provider it was not given; a member without an account is not dialled; `runJina` passes the 402 status and body through without leaking the key.
- Characterization of the 401/403 divergence above.

A temporary mutation that made the 402 rule non-fallback failed five of these tests and was reverted. All 15 pass offline; no provider was contacted and no real credential was used. The tests run against a symlinked, already-installed dependency tree owned by a sibling worktree; nothing was installed or changed.

Not run: the full suite, `test:ci`, the baseline verifier, any browser/e2e/Docker check, or any credential-backed Jina check. A mocked 402 is not proof that a real Jina account returns that status.
