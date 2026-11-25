

## Public guide provenance before main integration

MaxAI is a browser-backed web app, not a public API-key service. DurinDoor follows OmniRoute's pinned MaxAI executor: `POST https://api.maxai.me/gpt/cwc/chat`, a browser-minted Bearer access token and a request signature bound to the matching device and user identifiers. The access token expires and must be renewed through a browser session; the refresh endpoint is browser/TLS gated.

The provider includes a capture profile for `www.maxai.co` and `api.maxai.me`. Do not paste a token from another account into the captured session. All catalog models are account and plan dependent; the included model list is the OmniRoute release/v3.8.55 catalog snapshot and can become stale. MaxAI controls access, pricing, rate limits, and service availability.

- [OmniRoute pinned MaxAI registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/maxai/index.ts)

- [OmniRoute pinned MaxAI executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/maxai.ts)
