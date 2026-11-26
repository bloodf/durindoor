

## Public guide provenance before main integration

Cloudflare Playground is an anonymous, text-only provider. It requires no API key or cookie. The pinned OmniRoute executor connects to the playground's `cf_agent` chat protocol through a browser context because its WebSocket upgrade expects a browser TLS fingerprint. Cloudflare documents its Agents chat framework, but does not publish a public API contract for this Playground protocol.

Sources: [OmniRoute registry](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/cloudflare-playground/index.ts), [OmniRoute executor](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/cloudflare-playground.ts), [Cloudflare Agents chat docs](https://developers.cloudflare.com/agents/agent-class/communication-channels/chat/chat-agents/), [Cloudflare AI Playground](https://playground.ai.cloudflare.com/).

## Emulated tool calling

Ported in part from [OmniRoute #18313](https://github.com/cheaper-inference/OmniRoute/pull/18313). [The tool module](../../open-sse/translator/cloudflarePlaygroundTools.js) builds the contract and reads replies, [the conversation module](../../open-sse/translator/cloudflarePlaygroundConversation.js) enforces the message limits, and [the shared argument check](../../open-sse/utils/toolArgumentSchema.js) is also used by Microsoft 365 Copilot. The limits of 6000 characters and 10 user messages come from the upstream pull request's live captures. This checkout has only exercised them against an in-memory transport.

Not ported: the XML dialect recovery ladder beyond `<tool>` and `<tool_call>`, lenient JSON repair, fuzzy tool-name resolution, the repair retry with its strict-recovery flag, the contract reminder, reasoning-channel reading, and the added catalog model. A retry would open a second playground room and send a second quota-bearing request within one execution.
