# Keenable keyless web search and fetch (#1072)

Source: https://github.com/decolua/9router/pull/5604, pinned head `9e9a189f150970d2a37a419af79708f055a44716`. The PR is still open and unmerged at that head, so there is no merge SHA and the diff below is the open final-head diff. Vendor cross-check: the official `keenableai/keenable-sdk` repository at `36f3f0c1d1e241b5762e454329bb6393cbabb3eb` (Python client, filter table, models and the shared conformance fixtures).

## Adopted

`keenable` is a keyless (`noAuth`, `authType: "none"`, `category: "freeTier"`, same shape as `searxng`) webSearch/webFetch provider, selected only when a request or combo names it.

- Search: `POST https://api.keenable.ai/v1/search/public`, body `{ query, max_results, site?, exclude_domains?, published_after? }`. The `X-Keenable-Title` header is required by the public tier and is set to `durindoor`.
- Fetch: `GET https://api.keenable.ai/v1/fetch/public?url=…[&max_chars=…]`, markdown only; maps `title`, `content`, `author`, `published_at`.
- Registered through `open-sse/providers/registry/keenable.js`; `registry/index.js`, `open-sse/AGENT-INDEX.md` and `docs/providers/catalog.mdx` come from their generators (the catalog's unrelated OpenAI model-count drift was left out).
- Callers/normalizer/fetch adapter live in the existing `search/callers.js`, `search/normalizers.js` and `fetch/index.js`; no new route or discovery path.

## Differences from the upstream diff

- **`published_after` format.** Upstream sends relative values (`1d`, `7d`, `1mo`, `1y`). The SDK documents `published_after` as `YYYY-MM-DD`; relative offsets are documented only for `query_time`. DurinDoor reuses the existing `parallelAfterDate` helper and sends a UTC date.
- **Fixed endpoints.** Upstream's fetch accepted `providerConfig.baseUrl`. Both endpoints are constants here; `provider_options.baseUrl`, connection URLs and registry overrides are ignored.
- **Redirects.** Registry configs set `preventRedirects: true`, so the existing search dispatcher never follows a hop even on the keyless trusted path (which otherwise keeps platform redirect behavior). Fetch already goes through `guardedProbeFetch` with `redirect: "manual"`; a 3xx becomes a 502.
- **Strict inputs.** Hosts-only domain filters, `max_results` 1–50, unknown `time_range`, non-integer `max_characters` return 400. Malformed upstream bodies (null, non-object results) are tolerated instead of throwing.
- **Truncation.** Upstream changed the shared `truncate` helper for every fetch provider to count code points. That would alter built-in fetch behavior, so the code-point truncation is local to Keenable.
- **Not adopted:** the `/v1/models` route rewrite that lists no-auth web providers without connections (it adds endpoint discovery and changes the listing for every keyless provider), the `tests/__baseline__/alias-baseline.json` edit (that directory is not editable here), and skill-document rows for the other client. `mode`, `objective`, `query_time`, `disable_cards`, `live` and `prompt` are not sent; the SDK's default `mode: "pro"` is not sent either, so no mode selection can reach a paid tier.

## Behavior kept unchanged

Default routes and auto combos (the registry marker `autoComboNoAuth` is absent and category is not `free`), admission and API-key policy, proxy and provider-account scope (`getNoAuthProviderCredentials` is the existing selector), the route-level and handler-level outbound URL checks for the page being fetched, and every built-in provider's search/fetch behavior. There is no automatic fallback onto Keenable. A failed Keenable call returns its own status (429 keeps 429) so a combo that already names it can move on.

## Cancellation and errors

Search and fetch abort their upstream request at the provider timeout (15 s / 30 s) and return 504; transport failures return 502; upstream non-2xx keeps its status and the `message`/`error`/`detail` text. The handlers do not receive the client's abort signal today, so client disconnect does not cancel an in-flight Keenable request. That is existing handler behavior shared by all providers and is not changed here.

## Verification

`tests/unit/port9r-keenable-web-provider-5604.test.js`: offline fixtures with a stubbed `fetch`, covering registration, request/response mapping, filter rejection, no credentials sent, fixed origin, redirect refusal, error passthrough, timeout abort, URL policy and the absence of discovery. No provider was contacted and no credential was used. `gen-registry-index --check` and `check-agent-index` pass. `tests/__baseline__/verify-alias.mjs` and `verify-providers.mjs` already report drift from earlier ports and now also list `keenable`; those baselines are not edited here.
