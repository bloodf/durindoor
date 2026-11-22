

## Public guide provenance before main integration

Cloudflare Playground is an anonymous, text-only provider. It requires no API key or cookie. The pinned OmniRoute executor connects to the playground's `cf_agent` chat protocol through a browser context because its WebSocket upgrade expects a browser TLS fingerprint. Cloudflare documents its Agents chat framework, but does not publish a public API contract for this Playground protocol.

Sources: [OmniRoute registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/cloudflare-playground/index.ts), [OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/cloudflare-playground.ts), [Cloudflare Agents chat docs](https://developers.cloudflare.com/agents/agent-class/communication-channels/chat/chat-agents/), [Cloudflare AI Playground](https://playground.ai.cloudflare.com/).
