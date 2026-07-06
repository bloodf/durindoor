# Provider Nodes and Custom Providers

Provider nodes let you add endpoints that are compatible with common AI APIs even when DurinDoor does not have a dedicated provider integration for them. This is the preferred way to connect internal gateways, self-hosted models, company proxies, or vendors that expose OpenAI-compatible or Anthropic-compatible routes.

## Node Types

| Node type | Use when | Client request format |
| --- | --- | --- |
| OpenAI-compatible node | The upstream accepts OpenAI chat, embeddings, images, or similar `/v1` routes. | OpenAI-compatible. |
| Anthropic-compatible node | The upstream accepts Claude Messages-style requests. | DurinDoor translates when required. |
| Custom embedding provider | The upstream only provides embeddings or requires a dedicated embedding setup. | Embeddings route. |
| Passthrough model provider | You want DurinDoor to expose models from an upstream without enumerating every model manually. | Depends on the provider node. |

## Add an OpenAI-Compatible Node

1. Open `Dashboard -> Provider Nodes`.
2. Choose `Add Node`.
3. Select OpenAI-compatible mode.
4. Enter the base URL, for example `https://gateway.example.com/v1`.
5. Add the API key expected by the upstream. If the upstream is local and does not validate keys, enter a harmless placeholder value such as `local-dev-key`; compatible-node setup still requires a value.
6. Add one or more model names or enable passthrough behavior if supported.
7. Save and test.

Use a stable provider alias when clients need predictable model strings.

## Add an Anthropic-Compatible Node

1. Open `Dashboard -> Provider Nodes`.
2. Choose Anthropic-compatible mode.
3. Enter the upstream base URL.
4. Save credentials and supported models.
5. Test with a Claude-compatible model request.

DurinDoor can translate between OpenAI-style clients and Anthropic-style upstreams, but not every provider-specific feature maps perfectly. Test tools, images, reasoning, and streaming behavior before relying on the node for production traffic.

## Model Names and Aliases

A model string can identify a registry provider, a compatible provider node, a custom alias, or a combo. Keep names stable for client tools.

Recommended naming rules:

- Use lowercase provider aliases when possible.
- Keep upstream model names unchanged after the slash.
- Avoid spaces in aliases and model IDs.
- Create a combo for user-facing names such as `coding-default`.
- Reserve raw upstream IDs for operators and debugging.

```text
openai-compatible-lab/llama-3.1-70b
anthropic-compatible-internal/claude-sonnet
custom-embedding-search/text-embedding-model
coding-default
```

## When to Use Provider Nodes

Provider nodes are useful for:

- Local model servers such as Ollama, LM Studio, or vLLM.
- Organization gateways that already enforce billing and access control.
- Vendor endpoints not yet present in the DurinDoor registry.
- Temporary provider experiments.
- Regional mirrors or proxy endpoints.
- Self-hosted embedding, reranking, image, TTS, or STT services.

For completely no-auth local models, prefer the dedicated local provider path when one exists, such as `ollama-local`. Compatible provider nodes require an API-key field even when the upstream ignores it.

## Proxy Pools

DurinDoor includes proxy pool management for routing upstream provider traffic through configured proxies. Proxy pools can help with regional routing, egress control, or network isolation. They do not make an unsupported provider officially supported, and they do not bypass provider terms.

The dashboard includes tools for testing proxy nodes and deploying a Cloudflare Worker relay when configured with a valid Cloudflare account and Workers API token.

## Validation Checklist

Before using a custom provider in a combo:

1. Confirm `/v1/models` exposes the expected model names.
2. Send a small chat request.
3. Test streaming if client tools require it.
4. Test tool calls if the model will be used by coding agents.
5. Test images, audio, embeddings, or reranking only when those endpoints are required.
6. Check usage logs for provider name, model name, latency, and error handling.

## Operational Notes

- Custom nodes may not support every OpenAI parameter.
- Some upstreams reject content-part arrays, tool calls, reasoning fields, or unknown options.
- DurinDoor tries to normalize requests, but provider-specific limitations still apply.
- Prefer one provider node per upstream behavior profile instead of hiding incompatible models behind the same node.
