# #1073: Existing Cursor HTTP/2 proxy contract

## Pins and source

- OmniRoute PR #14735 verified head: [`4a6bed8ba7bb8f2d0f6d968e73af3d038ba5763b`](https://github.com/cheaper-inference/OmniRoute/commit/4a6bed8ba7bb8f2d0f6d968e73af3d038ba5763b); exact PR patch: [#14735.patch](https://github.com/cheaper-inference/OmniRoute/pull/14735.patch).
- Enclosing merge: [`256c6c4e874e2c0609289e2582421c913f0418b2`](https://github.com/cheaper-inference/OmniRoute/commit/256c6c4e874e2c0609289e2582421c913f0418b2). The merge contains unrelated changes; this assessment uses only the named PR patch.
- Local comparison head: `d7c7fcde0ea7da05f076d4cc86b0f85430e9224e`.

## Contract and current behavior

The provider proxy is an existing egress contract. `resolveConnectionProxyConfig` resolves legacy connection URLs, assigned proxy pools (including strict pools), relay URLs, and direct mode in [`connectionProxy.js`](../../../src/lib/network/connectionProxy.js). The ordinary [`proxyFetch.js`](../../../open-sse/utils/proxyFetch.js) path consumes connection proxy options and environment proxies, honors `NO_PROXY`, and supports relays. `shouldUseProxyAwareTransport` identifies configured connection/strict/relay routes and applicable environment proxies; `resolveProxyForRequest` provides shared connection/environment/direct resolution.

Cursor's installed HTTP/2 transport itself still opens a raw direct socket: [`makeHttp2Request`](../../../open-sse/executors/cursor.js) and [`openAgentHttp2Stream`](../../../open-sse/executors/cursor.js) call `http2.connect` without a proxy socket. However, dispatch does not silently use that transport when proxy routing applies. In `execute`, a proxy-applicable AgentService request is kept off the AgentService branch; regular chat dispatch evaluates `shouldUseProxyAwareTransport` and sends it through `makeFetchRequest` -> `proxyAwareFetch`, passing the resolved `proxyOptions`. For applicable routes, requests therefore use the proxy-aware legacy ChatService path. An HTTP relay is also preserved there. The account-specific AgentService model catalog fetch returns `null` when a proxy applies rather than making a direct request ([`cursorModels.js`](../../../open-sse/services/cursorModels.js)).

## Ordinary fixture evidence

[`cursor-agent-strict-proxy.test.js`](../../../tests/unit/cursor-agent-strict-proxy.test.js) uses mocked transport methods and verifies configured connection proxies, strict pools, relays, and `HTTPS_PROXY` do not open AgentService HTTP/2; `execute()` routes proxy-applicable text requests to the proxy-honoring fetch path with the same options. It also checks unproxied requests retain the direct AgentService path. [`cursor-models.test.js`](../../../tests/unit/cursor-models.test.js) verifies a proxy-bound model lookup resolves to `null`, makes no HTTP/2 connection, and remains separate from direct catalog caching. These are ordinary offline mocks; no live traffic is needed to establish the dispatch contract.

## Disposition: OmniRoute #14735

**Already covered locally; no patch required.** The PR's raw HTTP/2 bypass premise accurately describes a transport-level limitation, but the local dispatcher prevents the direct HTTP/2 transport from being selected for a request with an applicable configured or ambient proxy. It uses the existing proxy-aware chat transport instead. The PR's tunnel implementation is not present locally, but its behavior is unnecessary to satisfy the current provider contract. Keep sign-in, account handling, routing ownership, and redirect handling unchanged.

## Acceptance

No implementation change is recommended, so no new acceptance test is required. Existing ordinary offline acceptance is the fixture evidence above: with a proxy applicable, assert no direct HTTP/2 session opens and the proxy-aware legacy request receives the same `proxyOptions`; without a proxy, retain direct HTTP/2 dispatch. Do not add live probes or proxy traffic.
