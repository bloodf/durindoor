<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-banner.png">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-banner.png" alt="Ancient stone portal glowing green in dark ruins" width="100%">
  </a>
</p>

<p align="center">
  <a href="https://github.com/bloodf/durindoor/blob/main/assets/durindoor-wordmark-theme-aware.svg">
    <img src="https://raw.githubusercontent.com/bloodf/durindoor/main/assets/durindoor-wordmark-theme-aware.svg" alt="DurinDoor — Speak, friend, and enter. One guarded gateway for every AI provider" width="760">
  </a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/durindoor"><img alt="npm" src="https://img.shields.io/npm/v/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/bloodf/durindoor.svg"></a>
  <a href="https://github.com/bloodf/durindoor/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main"></a>
</p>

<p align="center">
  <strong>Add provider credentials once in a self-hosted dashboard, then point any OpenAI-compatible tool at a single local endpoint with unified usage tracking, provider combos, and request logs.</strong>
</p>

## 🗺️ Explore

- [Why DurinDoor?](#-why-durindoor)
- [How it works](#-how-it-works)
- [Quick start](#-quick-start)
- [Connect your tools](#-connect-your-tools)
- [What DurinDoor handles](#-what-durindoor-handles)
- [API surface](#-api-surface)
- [Architecture](#-architecture)
- [Security and operations](#-security-and-operations)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [Acknowledgments](#-acknowledgments)

## 🚪 Why DurinDoor?

DurinDoor is a self-hosted AI gateway that sits between your tools and your providers. It keeps provider credentials on your own machine and exposes one local API every OpenAI-compatible client can speak.

- **One local endpoint** — Configure tools once against `http://localhost:20128/v1` instead of wiring each app to a different provider.
- **Reusable provider connections** — Add an OAuth login, API key, cookie, or compatible endpoint once; every tool shares it.
- **Account and combo fallback** — Chain multiple connections for resilience, or stack models behind one stable name so a failed attempt retries the next option.
- **Format translation** — Send OpenAI-shaped requests and have them translated for Claude, Gemini, Kiro, Cursor, Ollama, Vertex, and other upstream formats.
- **Usage visibility** — Inspect provider, model, tokens, cost estimates, latency, and fallback outcome per request in the dashboard.
- **Self-hosted state** — Storage, credentials, and logs live in your `DATA_DIR`; you control where it runs and who can reach it.

DurinDoor is a fork of [9router](https://github.com/decolua/9router). Existing installations can keep their data, keys, and headers.

## 🧭 How it works

```mermaid
flowchart LR
    Client[OpenAI-compatible tool] -->|/v1 request + DurinDoor key| Route[/Compatibility API/]
    Route --> Handler[Auth + model/alias/combo resolution]
    Handler --> Core[Routing and translation core]
    Core -->|translate request| Provider[Upstream provider]
    Provider -->|stream or JSON| Core
    Core -->|translate response| Client
    Core --> DB[(SQLite usage + logs)]
```

1. A client sends a request to `/v1` with a DurinDoor API key and a model string (provider model, alias, or combo name).
2. DurinDoor validates the key, resolves the model, and selects an available provider connection.
3. If the client and provider speak different formats, the request and response are translated; the upstream call is made with stored credentials.
4. Usage, latency, and outcome are written to local SQLite, and the response streams back to the client in the client's format.

The model field accepts several shapes, resolved before any upstream call:

| Model string | Example | Resolves to |
| --- | --- | --- |
| Provider model | `openai/gpt-4.1` | A provider ID plus an upstream model. |
| Provider alias | `cc/claude-sonnet` | A registry alias for an upstream model. |
| Compatible node | `openai-compatible-lab/model-name` | A custom provider node plus its model. |
| Model alias | `daily-coder` | A user-defined alias mapped to another model. |
| Combo name | `coding-default` | An ordered fallback chain of models. |

Credential selection avoids accounts that are temporarily locked, expired, or excluded by the current fallback attempt, and refreshes OAuth tokens when the upstream supports refresh.

See [Architecture](docs/ARCHITECTURE.md) and [Smart Routing](docs/features/smart-routing.md) for the internal request lifecycle and failure handling.

## ⚡ Quick start

**Requirements:** Node.js `20.20.2` and npm `10.8.2` (also bundled in the Docker image).

Install the CLI globally and start the gateway:

```bash
npm install -g durindoor
durindoor
```

On first run DurinDoor creates `DATA_DIR` and initializes the database. Default surfaces:

| Surface | URL |
| --- | --- |
| Dashboard | http://localhost:20128/dashboard |
| API base | http://localhost:20128/v1 |
| Health check | http://localhost:20128/api/health |

1. Open the dashboard and sign in with the `INITIAL_PASSWORD` you set (or the local default). Change it before exposing the instance.
2. Add a provider connection under **Providers** (OAuth login, API key, compatible endpoint, or local provider).
3. Create a DurinDoor API key under **API Keys**. New keys have the shape `sk-<machine>-<key>-<crc>`; older `sk-*` keys remain supported. The full key is shown once — store it.
4. Send a request:

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "messages": [
      {"role": "user", "content": "Reply with one short sentence."}
    ],
    "max_tokens": 32
  }'
```

Replace `MODEL_ID` with a model ID, alias, or combo name from your dashboard.

### Other ways to run DurinDoor

<details>
<summary>Run without installing (npx, evaluation only)</summary>

```bash
npx durindoor
```

Use `npx` for quick evaluation. For daily use, install globally or run from source.

</details>

<details>
<summary>Run from source</summary>

```bash
git clone https://github.com/bloodf/durindoor.git
cd durindoor
npm install --no-audit --no-fund
npm run build
npm start
```

For development, `npm run dev` serves on port `20127` (production uses `20128`).

</details>

<details>
<summary>Run with Docker</summary>

Pin a version tag for production; do not rely on `latest` for stability:

```bash
docker run -d \
  --name durindoor \
  -p 127.0.0.1:20128:20128 \
  -v "$HOME/.durindoor:/app/data" \
  -e DATA_DIR=/app/data \
  -e JWT_SECRET="change-me" \
  -e INITIAL_PASSWORD="change-me" \
  ghcr.io/bloodf/durindoor:3.9.0
```

See [Cloud Deployment](docs/deployment/cloud.md) for the full production compose setup, and [Upgrading](docs/operations/upgrading.md) before moving between versions.

</details>

See [Installation](docs/getting-started/installation.md) for the full configuration reference, data paths, and environment variables.

More in the [Quick Start](docs/getting-started/quick-start.md) and [Installation](docs/getting-started/installation.md) guides.

## 🧩 Connect your tools

Point any OpenAI-compatible client at one base URL with your DurinDoor key:

```text
Base URL: http://localhost:20128/v1
API key:  your DurinDoor API key
Model:    a model ID, alias, or combo name from the dashboard
```

Integration guides for popular tools:

- [Claude Code](docs/integration/claude-code.md)
- [OpenAI Codex](docs/integration/codex.md)
- [Cursor](docs/integration/cursor.md)
- [Cline](docs/integration/cline.md)
- [Roo Code](docs/integration/roo.md)
- [Continue](docs/integration/continue.md)
- [Ollama + Claude Code](docs/integration/ollama-claude.md)
- [Other OpenAI-compatible tools](docs/integration/other-tools.md)

Claude-compatible clients may expect `ANTHROPIC_BASE_URL`; see the per-tool guide.

From Python with the OpenAI SDK:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:20128/v1",
    api_key="YOUR_DURINDOOR_API_KEY",
)

resp = client.chat.completions.create(
    model="MODEL_ID",
    messages=[{"role": "user", "content": "Reply with one short sentence."}],
    max_tokens=32,
)
print(resp.choices[0].message.content)
```

For more SDK examples and the dashboard workflow, see the [Usage Guide](docs/guides/usage.md).

## ✨ What DurinDoor handles

### Compatible API families

| Family | Notes |
| --- | --- |
| Chat Completions | OpenAI-compatible `/v1/chat/completions`, the common entry point for most tools. |
| Responses | `/v1/responses` with compatibility rewrites for selected clients. |
| Claude Messages | `/v1/messages` for Claude-compatible clients and translation testing. |
| Models | `/v1/models` lists models available through configured providers, aliases, and nodes; `/v1/models/{provider}/{model}` returns one exact configured model. |
| Embeddings | `/v1/embeddings` routed to embedding-capable providers. |
| Images | `/v1/images/generations` and `/v1/images/edits`. Provider-dependent. |
| Audio | `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/translations`, `/v1/audio/voices`. Provider-dependent. |
| Web search / fetch | `/v1/search` and `/v1/web/fetch` through dedicated search providers. |
| Realtime | OpenAI-Realtime-shaped `/v1/realtime` WebSocket; text conversations only. |
| Rerank / moderation | `/v1/rerank` and `/v1/moderations` with providers that support them. |
| Token counting | `/v1/messages/count_tokens`. Provider support varies. |

A route existing does not mean every provider supports it; modalities are provider-dependent.

### Routing, combos, and visibility

| Capability | What it does |
| --- | --- |
| [Smart routing](docs/features/smart-routing.md) | Resolves model strings, selects an available connection, translates formats, and records usage. |
| [Account fallback](docs/features/smart-routing.md) | Retries another active connection for the same provider and model. |
| [Combos](docs/features/combos.md) | Chain models behind one stable name; a failed member falls through to the next. |
| [Usage and quota tracking](docs/features/quota-tracking.md) | Request logs, cost estimates, provider limits, and reset windows in the dashboard. |
| [Compression](docs/features/compression.md) | Opt-in prompt compression before upstream dispatch; fail-open by design. |
| [MCP Gateway](docs/features/mcp-gateway.md) | Expose multiple MCP servers behind managed keys and routes. |
| [Realtime](docs/features/realtime.md) | Text WebSocket sessions in the OpenAI Realtime shape. |

Common combo strategies:

| Strategy | Typical order |
| --- | --- |
| Reliability first | Most reliable paid provider, then secondary provider, then local fallback. |
| Cost control | Subscription or local model, then low-cost API, then premium model. |
| Latency first | Fast local or small model, then balanced model, then larger model. |
| Capability first | Strongest model, then compatible backup, then simpler fallback. |

A combo member can still use multiple accounts for the same provider before falling through to the next member. Use request logs to confirm which model served each request.

### Providers and local/custom endpoints

| Connection type | Credential shape |
| --- | --- |
| OAuth | Browser login, device code, or OAuth callback. |
| API key | Provider API key or token. |
| Compatible endpoint | OpenAI-compatible or Anthropic-compatible URL. |
| Local provider | Local URL, no remote account. |

See [Provider Connections](docs/providers/subscription.md), [Provider Nodes and Custom Providers](docs/providers/cheap.md), and [Free and Local Providers](docs/providers/free.md). All modality support is provider-dependent.

## 🔌 API surface

Base URL: `http://localhost:20128/v1` (use your HTTPS origin for remote deployments).

```http
Authorization: Bearer YOUR_DURINDOOR_API_KEY
```

Use DurinDoor API keys generated in the dashboard; do not send upstream provider keys to client-facing routes.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/v1/chat/completions` | POST | OpenAI-compatible chat (most tools). |
| `/v1/responses` | POST | Responses API with compatibility rewrites. |
| `/v1/messages` | POST | Claude Messages for Claude-compatible clients. |
| `/v1/messages/count_tokens` | POST | Token counting (provider-dependent). |
| `/v1/models` and `/v1/models/{provider}/{model}` | GET | Available models or one exact configured provider-prefixed model. |
| `/v1/embeddings` | POST | Embeddings. |
| `/v1/images/generations` | POST | Text-to-image. |
| `/v1/images/edits` | POST | Image edits. |
| `/v1/audio/speech` | POST | Text-to-speech. |
| `/v1/audio/transcriptions` | POST | Transcription. |
| `/v1/audio/translations` | POST | Translation. |
| `/v1/audio/voices` | GET | Available voices. |
| `/v1/search` | POST | Web search. |
| `/v1/web/fetch` | POST | Web fetch. |
| `/v1/realtime` | WS | Realtime text WebSocket. |
| `/v1/rerank` | POST | Rerank (provider-dependent). |
| `/v1/moderations` | POST | Moderation (provider-dependent). |
| `/api/health` | GET | Health check (no provider setup needed). |

Full details, per-key model and lifetime policy fields, and compatibility notes are in the [API Reference](docs/reference/api.md).

## 🏗️ Architecture

DurinDoor is a Next.js gateway with a dashboard and an OpenAI-compatible compatibility API.

| Area | Responsibility |
| --- | --- |
| Dashboard routes | Browser UI for providers, combos, usage, endpoint setup, tools, tunnels, MITM, MCP, and settings. |
| Compatibility API | OpenAI-compatible and related client-facing routes under `/v1` and `/v1beta`. |
| Routing layer (`src/sse`) | Request entry, auth, model/combo resolution, and service dispatch. |
| Core engine (`open-sse`) | Provider execution, translation, streaming, fallback, token refresh, and usage extraction. |
| `open-sse` translators | Convert between OpenAI, Anthropic Claude, Gemini, Responses, Kiro, Cursor, CommandCode, Ollama, Vertex, and other formats. |
| SQLite persistence | Driver, migrations, repositories, and backups under `DATA_DIR`. |

Two fallback layers operate inside the routing core: **account fallback** picks another active connection for the same provider and model, and **combo fallback** moves to the next model in an ordered combo chain. The OpenAI-pivot translation layer keeps client and provider formats separate so one client can reach many upstreams.

See [Architecture](docs/ARCHITECTURE.md) for the request lifecycle, routing internals, and extension points.

## 🔐 Security and operations

DurinDoor stores provider credentials and routes model traffic — treat it as sensitive infrastructure.

- **Prefer localhost-only binding.** The CLI binds `0.0.0.0` by default, so run `durindoor --host 127.0.0.1` for local-only use. Source runs default to `127.0.0.1` when `HOSTNAME` is unset. Docker sets `HOSTNAME=0.0.0.0` inside the container; keep it private with host-side mapping such as `-p 127.0.0.1:20128:20128`. Do not expose the dashboard publicly with only the default password.
- **Separate DurinDoor keys from upstream credentials.** Client tools use DurinDoor API keys; upstream provider keys, OAuth tokens, and cookies stay in `DATA_DIR` and are never sent to client-facing routes.
- **Set explicit production secrets.** Define `JWT_SECRET`, `API_KEY_SECRET`, and a strong `INITIAL_PASSWORD` before any remote exposure.
- **Use HTTPS and restrict dashboard access.** Reverse proxy with auth, VPN, firewall, or trusted-network allowlist; set `AUTH_COOKIE_SECURE=true` behind HTTPS.
- **Back up `DATA_DIR`.** Protect `db/data.sqlite`, `db/backups/`, `auth/`, and `mitm/` as secrets.
- **Review the security docs before exposure.** See [Security and Production Hardening](docs/operations/security.md), [Startup and Runtime Operations](docs/operations/startup.md), and [Environment Variables](docs/reference/environment.md).
- **Keep request logging off by default.** Detailed logs may include prompts, responses, and file names; set `ENABLE_REQUEST_LOGS=false` unless actively debugging, with a defined retention and access policy.
- **Treat tunnels as exposure.** HTTPS tunnels make the gateway reachable from another network — keep dashboard auth on, prefer dedicated keys, and disable tunnels when unused.

### Compatibility notes

DurinDoor is a fork of [9router](https://github.com/decolua/9router). These compatibility names remain supported so prior installations can migrate without losing data:

- Storage path `~/.9router` (override with `DATA_DIR`).
- Legacy API keys in the `sk-<8 hex>` shape alongside current `sk-<machine>-<key>-<crc>` keys.
- Internal headers prefixed `X-9Router-` and their `X-DurinDoor-` equivalents.

## 📚 Documentation

The canonical documentation is Markdown in this repository; GitHub-rendered Markdown is the source of truth.

- **Index** — [docs/README.md](docs/README.md#users)
- **Getting started**
  - [Quick Start](docs/getting-started/quick-start.md)
  - [Installation](docs/getting-started/installation.md)
  - [Usage Guide](docs/guides/usage.md)
- **Providers** — [connections](docs/providers/subscription.md), [custom nodes](docs/providers/cheap.md), [free and local](docs/providers/free.md)
- **Features** — [Smart Routing](docs/features/smart-routing.md), [Combos](docs/features/combos.md), [Usage and Quota Tracking](docs/features/quota-tracking.md), [Compression](docs/features/compression.md), [MCP Gateway](docs/features/mcp-gateway.md), [Realtime](docs/features/realtime.md)
- **Reference** — [API Reference](docs/reference/api.md), [Environment Variables](docs/reference/environment.md), [Architecture](docs/ARCHITECTURE.md)
- **Operations** — [Security](docs/operations/security.md), [Startup](docs/operations/startup.md), [Troubleshooting](docs/troubleshooting.md), [FAQ](docs/faq.md)
- **Community and project** — [Security Policy](.github/SECURITY.md), [Contributing](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md), [Changelog](CHANGELOG.md), [License](LICENSE), [Issues](https://github.com/bloodf/durindoor/issues), [Discussions](https://github.com/bloodf/durindoor/discussions)

## 🤝 Contributing

Contributions are welcome. Read [Contributing](CONTRIBUTING.md), [Local Development](docs/development/local-development.md), and [Architecture](docs/ARCHITECTURE.md) before opening a pull request, and follow the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).

## 🙏 Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). This project builds on that foundation with a new identity, enhanced features, and an emphasis on keeping the doors of your AI stack open. Upstream documentation and branding remain the property of their respective authors and are not presented as DurinDoor's source of truth.
