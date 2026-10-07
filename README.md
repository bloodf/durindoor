<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/durindoor-logo-dark.svg">
    <img src="assets/brand/durindoor-logo-light.svg" alt="DurinDoor" width="440">
  </picture>
</p>

<p align="center"><em>Speak, friend, and enter.</em></p>

<p align="center">
  <img src="assets/brand/durindoor-gateway.webp" alt="An engraved stone gateway opening into emerald light" width="100%">
</p>

<p align="center">
  <b>Your AI providers. One self-hosted gateway.</b><br>
  OpenAI and Anthropic APIs, subscriptions, API keys, and local models.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/durindoor"><img alt="npm version" src="https://img.shields.io/npm/v/durindoor.svg?color=066247"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/github/license/bloodf/durindoor.svg?color=066247"></a>
  <a href="https://github.com/bloodf/durindoor/actions/workflows/ci.yml"><img alt="CI status" src="https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main&color=066247"></a>
</p>

<p align="center">
  <a href="https://durindoor.vercel.app">Website</a> ·
  <a href="https://durindoor.vercel.app/demo-preview">Live demo</a> ·
  <a href="https://durindoor.vercel.app/docs">Documentation</a> ·
  <a href="#quick-start">Quick start</a>
</p>

## One gateway for the tools you already use

DurinDoor connects your AI clients to provider subscriptions, API keys, and local models. Send OpenAI chat completions or Responses, or Anthropic Messages. The gateway resolves the model, chooses a connection, translates supported formats, and records the result.

Use a provider/model ID for a direct route, an alias for a reusable name, or a combo for a configured fallback order. Manage connections and keys in the bundled dashboard.

DurinDoor is a fork of [9router](https://github.com/decolua/9router). Its name comes from Durin's Door, the entrance to Moria in *The Lord of the Rings*. The new identity uses an emerald gate, silver lettering, and dark forest stone.

| What you need | What DurinDoor provides |
| --- | --- |
| Connect different providers | OAuth accounts, API keys, browser cookies, and compatible endpoints |
| Keep a stable model name | Model aliases and ordered fallback combos |
| Recover from account limits | Account selection, cooldowns, and quota-aware fallback |
| Inspect requests | Usage, monitoring, and an optional redacted proxy timeline |
| Connect MCP servers | A gateway with scoped keys for upstream MCP instances |
| Run on your infrastructure | SQLite by default, optional Postgres, and Docker deployment |

Credentials, configuration, and usage records are stored on your machine or server. Requests still go to the upstream providers you select. Support for each endpoint and model depends on that provider.

## Try the dashboard

[Open the live demo](https://durindoor.vercel.app/demo-preview) to explore the real DurinDoor dashboard with sample data. The demo intercepts requests in your browser and does not connect real provider accounts.

For an installed instance, the dashboard is at `http://localhost:20128/dashboard`. Connect a provider, create a key, configure model aliases or combos, and inspect usage from the same interface.

## Quick start

Use Node.js `20.20.2` and npm `10.8.2`. The Docker image includes the required runtime.

### 1. Start the gateway

Set a session-signing secret and your initial dashboard password before the first boot. Replace the password below with your own.

```bash
export JWT_SECRET="$(openssl rand -hex 32)"
export INITIAL_PASSWORD="CHANGE_ME_STRONG_PASSWORD"
npx durindoor --host 127.0.0.1
```

Keep `JWT_SECRET` in your deployment environment for subsequent starts. For daily use, install the CLI globally:

```bash
npm install -g durindoor
durindoor --host 127.0.0.1
```

The dashboard opens at `http://localhost:20128/dashboard`. Sign in with your initial password. The explicit host flag keeps this example bound to your machine.

### 2. Connect a provider and create a key

In **Providers**, add an OAuth account, a provider API key, or a compatible local or remote endpoint. In **API Keys**, create a DurinDoor key and copy its secret.

Choose an available model in the dashboard or list the models exposed by your instance:

```bash
export DURINDOOR_API_KEY="YOUR_DURINDOOR_API_KEY"

curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer $DURINDOOR_API_KEY"
```

### 3. Send a request

Replace `PROVIDER/MODEL` with a model ID from your instance. A name such as `coding-default` works after you create that alias or combo.

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "PROVIDER/MODEL",
    "messages": [{"role": "user", "content": "Say hello."}],
    "stream": true
  }' \
  -N
```

[Installation](https://durindoor.vercel.app/docs/getting-started/installation) covers npm, source builds, Docker, environment variables, and the data directory. [First request](https://durindoor.vercel.app/docs/getting-started/first-request) covers both API formats, SDKs, streaming, and errors.

## Use OpenAI or Anthropic APIs

Your client's request format determines the route. DurinDoor translates it to the selected provider's supported format.

| Client format | Route |
| --- | --- |
| OpenAI Chat Completions | `POST /v1/chat/completions` |
| OpenAI Responses | `POST /v1/responses` |
| Anthropic Messages | `POST /v1/messages` |

### OpenAI SDK

Point the SDK at the gateway and use a DurinDoor key. Replace the example model with one exposed by your instance.

```javascript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:20128/v1",
  apiKey: process.env.DURINDOOR_API_KEY,
});

const response = await client.chat.completions.create({
  model: "PROVIDER/MODEL",
  messages: [{ role: "user", content: "Say hello." }],
});

console.log(response.choices[0].message.content);
```

### Anthropic Messages

The Messages route accepts Anthropic-shaped requests, including the required `max_tokens` field. Use a model your connected provider can serve.

```bash
curl http://localhost:20128/v1/messages \
  -H "Authorization: Bearer $DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "PROVIDER/MODEL",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "Say hello."}]
  }'
```

Tool-specific settings matter. Follow the guides for [Claude Code](https://durindoor.vercel.app/docs/integrations/claude-code), [Codex](https://durindoor.vercel.app/docs/integrations/codex), [Cursor](https://durindoor.vercel.app/docs/integrations/cursor), and [other clients](https://durindoor.vercel.app/docs/integrations).

## Choose your providers and fallback order

The [provider catalog](https://durindoor.vercel.app/docs/providers/catalog) lists registry IDs, authentication methods, and model counts for the build. `GET /v1/models` lists what your running instance exposes.

| Connection type | Examples |
| --- | --- |
| Provider API keys | OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek |
| Subscription and tool accounts | Claude Code, Codex, Gemini CLI, Kiro, GitHub Copilot |
| Cloud platforms | AWS Bedrock, Azure, Vertex, Cloudflare AI |
| Compatible endpoints and local models | OpenAI or Anthropic nodes, Ollama, LM Studio, vLLM |
| Media and search providers | Image, speech, video, embeddings, search, and fetch providers |

A combo exposes one name to your client and tries its configured model members in order. For example, you can put a subscription model first, a paid API second, and a local model last. That order is your configuration. It is not a built-in pricing hierarchy. Account fallback tries eligible connections for the current member before advancing to the next model.

Read [Connecting accounts](https://durindoor.vercel.app/docs/providers/connecting-accounts), [Combos](https://durindoor.vercel.app/docs/features/combos), and [Smart routing](https://durindoor.vercel.app/docs/features/smart-routing) for setup and strategy details.

## Beyond chat

The gateway also has endpoints for images, speech, embeddings, reranking, moderation, video, music, web search, and web fetch. Model support varies by provider. Use the [API reference](https://durindoor.vercel.app/docs/reference/api) for exact request bodies and response formats.

- The [MCP gateway](https://durindoor.vercel.app/docs/features/mcp-gateway) connects several MCP servers behind scoped gateway keys.
- [Realtime](https://durindoor.vercel.app/docs/features/realtime) uses OpenAI-shaped text WebSocket events. Audio is not supported.
- [Media routes](https://durindoor.vercel.app/docs/features/media-routes) configure fallback order for calls that omit a model or use `auto`.
- The [proxy timeline](https://durindoor.vercel.app/docs/features/proxy-timeline) records redacted request hops when enabled. It is off by default.

## Run it with Docker

Set `JWT_SECRET` and `INITIAL_PASSWORD` as shown in the quick start, then:

```bash
docker run -d --name durindoor \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET \
  -e INITIAL_PASSWORD \
  ghcr.io/bloodf/durindoor:latest
```

This example persists data in `$HOME/.durindoor` and publishes the port on loopback. Pin a release tag for production. Native installs retain the `~/.9router` default data directory for compatibility unless you set `DATA_DIR`.

SQLite is the default database. The dashboard supports an optional Postgres cutover. See [Docker deployment](https://durindoor.vercel.app/docs/deployment/docker), [Environment variables](https://durindoor.vercel.app/docs/reference/environment), and [Security](https://durindoor.vercel.app/docs/operations/security) before exposing a shared gateway.

## Documentation

| Task | Guide |
| --- | --- |
| Install and make your first call | [Getting started](https://durindoor.vercel.app/docs/getting-started) |
| Add provider accounts or local models | [Providers](https://durindoor.vercel.app/docs/providers) |
| Configure an AI client | [Integrations](https://durindoor.vercel.app/docs/integrations) |
| Set up routing and capabilities | [Features](https://durindoor.vercel.app/docs/features) |
| Host a gateway | [Deployment](https://durindoor.vercel.app/docs/deployment) |
| Back up, upgrade, or manage access | [Operations](https://durindoor.vercel.app/docs/operations) |
| Look up routes, flags, or settings | [Reference](https://durindoor.vercel.app/docs/reference) |
| Diagnose a failed request | [Troubleshooting](https://durindoor.vercel.app/docs/troubleshooting) |

The [product guide](PRODUCT.md) describes the gateway’s scope. The [design system](DESIGN.md) records the website and documentation identity.

## Contribute

Issues and pull requests are welcome. Pair behavior changes with a doc update and a test. Read [Contributing](https://durindoor.vercel.app/docs/contributing), the [Code of Conduct](CODE_OF_CONDUCT.md), and the [security policy](.github/SECURITY.md).

Provider definitions live in [`open-sse/providers/registry/`](open-sse/providers/registry). Start with [`REGISTRY_TEMPLATE.js`](open-sse/providers/REGISTRY_TEMPLATE.js). Keep generated registry indexes generated.

## Visual identity

The identity pairs an emerald gate with silver lettering and forest stone. Cormorant Garamond carries the display lettering; Space Grotesk carries controls and documentation.

## License and acknowledgments

MIT. See [LICENSE](LICENSE).

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). Upstream documentation and branding remain the property of their respective authors.
