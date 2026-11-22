

## Public guide provenance before main integration

This provider is **unverified**. The tests run against an in-memory fake of the contract that OmniRoute's implementation uses. No live Zed account, token or request has been used.

- Live behavior is untested: the sign-in redirect, the encryption scheme (OAEP-SHA256 first, PKCS#1 v1.5 as fallback), the `x-zed-*` headers, the vendor `provider` strings and the NDJSON status frames come from OmniRoute's pinned source and could differ in Zed's current service.

- `x-zed-version` is pinned to `0.200.0`. Unlike OmniRoute, DurinDoor does not look up the latest Zed release. Set `providerSpecificData.appVersion` on a connection if Zed starts rejecting the pin.

- Zed's Google and OpenAI proxies are narrower than the vendors' own APIs. DurinDoor applies OmniRoute's adaptations (safety threshold `BLOCK_NONE`, lowercase function-calling modes, uppercase thinking level, no `developer` role).

- [OmniRoute zed-hosted registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/zed-hosted/index.ts)

- [OmniRoute Zed auth helpers](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/shared/zedAuth.ts)

- [OmniRoute Zed-hosted executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/zed-hosted.ts)

- [OmniRoute Zed-hosted sign-in](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/oauth/providers/zed-hosted.ts)

- [OmniRoute Zed-hosted quota probe](https://github.com/cheaper-inference/OmniRoute/blob/5ffa68e835442a12ed1204a2eebf4076c298aecb/open-sse/services/usage/zedHosted.ts)
