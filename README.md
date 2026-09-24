<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png" alt="Ancient stone portal glowing green in dark ruins" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg" alt="DurinDoor. Speak, friend, and enter. One guarded gateway for every AI provider" width="760">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/durindoor"><img alt="npm" src="https://img.shields.io/npm/v/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main"></a>
  <a href="https://ghcr.io/bloodf/durindoor"><img alt="Docker" src="https://img.shields.io/badge/docker-ghcr.io%2Fbloodf%2Fdurindoor-blue?logo=docker"></a>
</p>

<p align="center">
  <b>One self-hosted gateway. Every AI provider. Your keys never leave your machine.</b>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#why-durindoor">Why</a> ·
  <a href="#providers">Providers</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="https://durindoor.vercel.app/docs">Docs</a>
</p>

---

## 🚪 What is DurinDoor?

DurinDoor is a self-hosted AI gateway that unifies **236 providers** behind one OpenAI-compatible API. Add credentials once in the dashboard, point every tool, script, and IDE integration at `http://localhost:20128/v1`, and stop hand-wiring provider SDKs into every app you build. It runs entirely on your own machine or server: credentials, logs, and usage data stay in your `DATA_DIR`, never on someone else's cloud.

It is a fork of [9router](https://github.com/decolua/9router), rebuilt with a Postgres option, an MCP gateway, a management REST API, quota-aware account fallback, a proxy timeline, and a full documentation site, while staying a drop-in upgrade for existing 9router installs.

## 🤔 Why DurinDoor?

Every provider speaks its own dialect. OpenAI wants `messages`, Anthropic wants `messages` shaped differently and a separate `max_tokens`, Gemini wants `contents`, Ollama wants its own JSON, and half the AI coding tools on your machine only know how to talk to one of them. The usual fix is either vendor lock-in or a pile of brittle adapter code duplicated across every project.

DurinDoor puts one door in front of all of it:

- **Speak once, route anywhere.** Send OpenAI chat completions, Anthropic Messages, Gemini, or Ollama-shaped requests; DurinDoor translates to whatever the upstream provider actually expects and translates the response back.
- **Never lose a request to one dead account.** Model combos and quota-aware account fallback retry across accounts and providers automatically when one is rate-limited, out of credit, or down.
- **Keep everything local.** SQLite by default, an optional Postgres cutover for scale, and a data directory that never phones home.
- **Stop re-plumbing every client.** Claude Code, Codex, Cursor, Cline, Roo, Continue, and anything else that speaks OpenAI or Anthropic already works against `/v1` with zero code changes, only a base URL swap.

## ⚡ Quick start

<table>
<tr><th>npm</th><th>npx</th><th>Docker</th></tr>
<tr>
<td>

```bash
npm install -g durindoor
durindoor
```

</td>
<td>

```bash
npx durindoor
```

</td>
<td>

```bash
docker run -d --name durindoor \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e INITIAL_PASSWORD="$(openssl rand -hex 16)" \
  ghcr.io/bloodf/durindoor:latest
```

</td>
</tr>
</table>

Requires Node.js `20.20.2` and npm `10.8.2` (already baked into the Docker image). The CLI opens the dashboard at `http://localhost:20128/dashboard` on first run. Sign in, change the default password, connect a provider, and mint your first DurinDoor API key.

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"coding-default","messages":[{"role":"user","content":"Say hello."}],"stream":true}'
```

Building from source or running Compose with a Postgres profile? See [Installation](https://durindoor.vercel.app/docs/getting-started/installation) and [Docker](https://durindoor.vercel.app/docs/deployment/docker).

## 🌍 Providers

**236 providers** in the registry today, spanning:

| Category | Examples |
| --- | --- |
| 🧠 Frontier labs | OpenAI, Anthropic (Claude), Google (Gemini, Vertex), xAI (Grok), Mistral, Cohere |
| 🔀 Aggregators / routers | OpenRouter, Requesty, TokenRouter, ZenMux, AgentRouter, OmniRoute |
| 🖥️ CLI-tool bridges | Codex, Claude Code, Gemini CLI, Cursor, Cline, Kilo Code, Windsurf, Trae, Qoder, Kiro |
| ☁️ Cloud platforms | AWS Bedrock, Azure, Databricks, Snowflake, Vertex, DigitalOcean, Cloudflare AI |
| 🏠 Local / self-hosted | Ollama, LM Studio, vLLM, llama.cpp, Llamafile, text-generation-webui, Xinference |
| 🖼️ Image / video | Stability AI, Black Forest Labs (FLUX), Ideogram, Recraft, Leonardo, RunwayML, Kie |
| 🔊 Voice | ElevenLabs, Deepgram, Cartesia, PlayHT, Fish Audio, Edge TTS, AssemblyAI |
| 🔎 Search / fetch | Tavily, Exa, Brave Search, Serper, SearXNG, Firecrawl, Jina Reader, Linkup |
| 🧩 Free / no-key | Pollinations, DuckDuckGo Web, HackClub, LLM7, FreeAIAPIKey |

The full, generated list lives at [Provider catalog](https://durindoor.vercel.app/docs/providers/catalog); the source of truth is one file per provider under [`open-sse/providers/registry/`](open-sse/providers/registry). Adding a provider is a config change, not a rewrite: copy [`REGISTRY_TEMPLATE.js`](open-sse/providers/REGISTRY_TEMPLATE.js), list its models, and only write an executor when the upstream is not already OpenAI-compatible.

## 🛠️ Usage

All routes live under `/v1`. Format follows the path, not the provider: send whichever shape your client already speaks, DurinDoor translates it to the upstream.

**OpenAI-compatible chat, with streaming:**

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer $DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "openai/gpt-5.6",
        "messages": [{"role": "user", "content": "Explain quantum entanglement in one sentence."}],
        "stream": true
      }'
```

**Anthropic Messages format:**

```bash
curl http://localhost:20128/v1/messages \
  -H "Authorization: Bearer $DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "model": "anthropic/claude-sonnet-5",
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Say hello."}]
      }'
```

**OpenAI Responses format:**

```bash
curl http://localhost:20128/v1/responses \
  -H "Authorization: Bearer $DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "codex/gpt-5.4-mini", "input": "Write a haiku about routers."}'
```

**Any official SDK, unmodified, just repoint the base URL:**

```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:20128/v1",
  apiKey: process.env.DURINDOOR_API_KEY,
});

const response = await client.chat.completions.create({
  model: "coding-default",
  messages: [{ role: "user", content: "Refactor this function for clarity." }],
});
```

Beyond chat, the same `/v1` surface covers:

- 🖼️ **Images** — `POST /v1/images/generations`, `/v1/images/edits`
- 🔊 **Speech** — `POST /v1/audio/speech` (text-to-speech), `POST /v1/audio/transcriptions` and `/translations` (speech-to-text)
- 🎵 **Music and video** — `POST /v1/music/generations`, `/v1/video/generations`, async job polling under `/v1/videos`
- 📐 **Embeddings, rerank, moderation** — `POST /v1/embeddings`, `/v1/rerank`, `/v1/moderations`
- 🔎 **Web search and fetch** — `POST /v1/search`, `POST /v1/web/fetch`, backed by Tavily, Exa, Brave, Firecrawl, Jina Reader, and more
- 📡 **Realtime** — a text WebSocket at `GET /v1/realtime` in the OpenAI Realtime event shape
- 📦 **Files and batches** — OpenAI-style and Anthropic-style batch APIs over local storage
- 🔌 **MCP gateway** — one JSON-RPC endpoint merging tools from any number of upstream MCP servers behind a single scoped key
- 🚪 **Default media routes** — call any media endpoint with no `model` (or `"model": "auto"`) and DurinDoor runs the dashboard-ordered fallback chain for that kind; order lives in **Dashboard → Media Routes**. See [Media routes](https://durindoor.vercel.app/docs/features/media-routes)

Full route-by-route reference, request bodies, and streaming behavior: [API reference](https://durindoor.vercel.app/docs/reference/api).

## 📊 Dashboard

The bundled dashboard (`/dashboard`) is where you connect providers, mint API keys, and see what's actually happening:

- **Provider accounts** — OAuth or API-key connections, with automatic token refresh
- **Combos** — named fallback chains across models and accounts, with strategies and ceilings
- **Quota tracking** — per-provider snapshots that skip a spent account before it fails a live request
- **Usage** — per-key, per-model spend and token counts
- **Proxy timeline** — an optional redacted hop log for debugging a request end to end
- **MCP Gateway** — register upstream MCP servers and grant scoped keys to specific tools
- **Laya** — a local, self-hosted System One provider that replaces Jev for the smart/task combo complexity classifier, no API key required. See [Combos](https://durindoor.vercel.app/docs/features/combos#local-laya-instead-of-jev)
- **Docs** — the sidebar links to the [documentation site](https://durindoor.vercel.app/docs), including the full [API reference](https://durindoor.vercel.app/docs/reference/api)

Try it without installing anything: [hosted demo dashboard](https://durindoor.vercel.app/dashboard).

## ⚙️ Configuration

Two environment variables matter on a fresh install; everything else has a sane default:

```bash
JWT_SECRET=$(openssl rand -hex 32)   # required on a fresh data dir, signs dashboard sessions
DATA_DIR=/path/to/data               # defaults to ~/.9router (macOS/Linux) or %APPDATA%\9router (Windows)
```

DurinDoor ships with SQLite out of the box and no external database to run. When you outgrow it, cut over to Postgres from **Settings → Database** in the dashboard, or opt in at the Compose level with `docker compose --profile postgres18 up`. Every other operator variable, its default, and where it's read is documented at [Environment variables](https://durindoor.vercel.app/docs/reference/environment).

## 🔗 Documentation

| | |
| --- | --- |
| 🏁 [Getting started](https://durindoor.vercel.app/docs/getting-started) | Installation, first request, dashboard tour |
| 🌍 [Providers](https://durindoor.vercel.app/docs/providers) | Full catalog, connecting accounts, free/local options |
| ✨ [Features](https://durindoor.vercel.app/docs/features) | Smart routing, combos, quota tracking, MCP, realtime, compression |
| 🔌 [Integrations](https://durindoor.vercel.app/docs/integrations) | Claude Code, Codex, Cursor, Cline, Roo, Continue |
| 🚢 [Deployment](https://durindoor.vercel.app/docs/deployment) | Localhost, Docker, VPS/cloud, reverse proxy |
| 🔧 [Operations](https://durindoor.vercel.app/docs/operations) | Security, Postgres, upgrading, API key scoping |
| 📚 [Reference](https://durindoor.vercel.app/docs/reference) | Full API, CLI, environment variables, migrating from 9router |
| 🤝 [Contributing](https://durindoor.vercel.app/docs/contributing) | Local dev setup, architecture, translators, release process |

## 🤝 Contributing

Issues and pull requests are welcome. Open an issue before a large change, keep one focused branch per change, and pair a behavior change with a doc update and a test. See [Contributing](https://durindoor.vercel.app/docs/contributing), the [Code of Conduct](CODE_OF_CONDUCT.md), and the [security policy](.github/SECURITY.md) before you start.

## 📜 License

MIT. See [LICENSE](LICENSE).

## 🙏 Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). Upstream documentation and branding remain the property of their respective authors and are not presented as DurinDoor's source of truth.
