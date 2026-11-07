# ZeroLimit AI setup and contract

Add an API-key connection for ZeroLimit AI using a key obtained from the provider's Developer settings. Select `zerolimitai/auto` for provider-managed routing, or fetch the connection's models and select a current id. The provider can substitute models; an id is not a promise of a particular underlying model.

The [first-party API reference](https://www.zerolimitai.com/docs/api), inspected 2026-11-07, documents Bearer authentication, OpenAI chat completions, SSE and model discovery on the `www` host. DurinDoor uses that host directly to avoid redirects. The reference describes tool calling, including tool results, but account-backed behavior has not been verified here. No media services or usage integration are enabled.

The provider currently documents a limited evaluation period and paid API access afterward. Check its current terms before connecting. Account eligibility, credit, quotas, live model availability and compatibility remain unverified. No account, credential or inference API was used for this implementation. An unauthenticated 401 from earlier discovery is not acceptance evidence.

The [pinned OmniRoute entry](https://github.com/cheaper-inference/OmniRoute/blob/61e07fb7e0d4e1e76111495d3718c9e4d06d2a62/open-sse/config/providers/registry/zerolimitai/index.ts) declares the same endpoints and model passthrough. Unlike its empty catalog, this port seeds only the documented `auto` routing id. Other ids come from authenticated discovery. The icon is a neutral Material symbol; no provider artwork is included.

Offline unit coverage exercises registry publication, model parsing, default executor request construction and mocked model discovery/error handling. It does not establish live response, streaming or tool compatibility. Those require separately authorized account-backed verification.
