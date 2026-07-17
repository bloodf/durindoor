![DurinDoor](assets/durindoor-wordmark-theme-aware.svg)

# DurinDoor — Forge Your AI Gateway

[![npm](https://img.shields.io/npm/v/durindoor.svg)](https://www.npmjs.com/package/durindoor)
[![License](https://img.shields.io/github/license/bloodf/durindoor.svg)](https://github.com/bloodf/durindoor/blob/main/LICENSE)
[![Stars](https://img.shields.io/github/stars/bloodf/durindoor.svg)](https://github.com/bloodf/durindoor/stargazers)
[![CI](https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main)](https://github.com/bloodf/durindoor/actions)

---

DurinDoor is a self-hosted AI gateway that unifies the realm of LLM providers behind a single OpenAI-compatible API. Forge one gateway to rule them all — connect OpenAI, Anthropic, Google, and many others, then route your tools through a single endpoint with unified billing, usage tracking, and fallback logic.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Supported Providers](#supported-providers)
- [Model catalog](#model-catalog)
- [Migrating from durindoor](#migrating-from-durindoor)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgments](#acknowledgments)

## Features

- **Chat & Completions** — OpenAI-compatible `/v1/chat/completions` and `/v1/completions` endpoint.
- **Embeddings** — Route embedding requests to any supported provider.
- **Image Generation** — Generate images through providers that support image models.
- **Text-to-Speech & Speech-to-Text** — Unified TTS and STT routing.
- **Web Search & Fetch** — Built-in web search and fetch tooling.
- **MCP Gateway** — Expose Model Context Protocol servers through a single gateway.
- **Provider Combos** — Combine multiple providers into failover and load-balanced sets.
- **MITM Proxy** — Intercept and inspect AI traffic for debugging or transformation.
- **Usage Tracking** — Keep a ledger of tokens, requests, and cost across accounts.
- **Multi-Account Management** — Rotate keys and manage several accounts per provider.

## Quick Start

Install the DurinDoor CLI globally and step through the gate:

```bash
npm i -g durindoor
durindoor
```

Then open your browser and enter the dashboard:

```
http://localhost:20128
```

From the dashboard, add providers, create an API key, and point your tools at `http://localhost:20128/v1`.

## Installation

### npm (global)

```bash
npm i -g durindoor
durindoor
```

### Docker

DurinDoor provides a Docker image for those who prefer containers. Pull and run:

```bash
docker pull ghcr.io/bloodf/durindoor:latest
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DATA_DIR=/app/data \
  -v durindoor-data:/app/data \
  ghcr.io/bloodf/durindoor:latest
```

> DurinDoor's Docker image is `ghcr.io/bloodf/durindoor`. The `docker-compose.yml` in this repository is still being rebranded from the upstream project; use the `docker run` command above or compose your own service file with the `ghcr.io/bloodf/durindoor` image.

### From source

```bash
git clone https://github.com/bloodf/durindoor.git
cd durindoor
npm install
npm run build
npm start
```

## Configuration

DurinDoor is configured through environment variables. Set them in your shell, in a `.env` file, or in your container orchestrator.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `20128` | HTTP port the gateway listens on. |
| `HOSTNAME` | `0.0.0.0` | Network interface to bind. |
| `DATA_DIR` | `<<~/.durindoor>>` (legacy/migration compatibility) | Persistent storage directory. |
| `MCP_GATEWAY_OAUTH_PUBLIC_URL` | — | Public URL used for MCP Gateway OAuth callbacks. |
| `NODE_ENV` | `production` | Runtime environment (`development` or `production`). |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:20128` | Public base URL of the dashboard. |
| `SEARXNG_URL` | `http://localhost:8888/search` | Endpoint for the built-in unauthenticated SearXNG web-search provider. |

Run `durindoor --help` to see all CLI options and flags.

### Per-request token-saver bypass

Send `X-DurinDoor-Token-Saver: off` on a chat request to disable every token saver (RTK, Headroom, compression seam, caveman, ponytail, pxpipe) for that request only. The exact value `off` (case-insensitive) bypasses; any other value keeps savers enabled. The legacy `X-9Router-Token-Saver` header is accepted as an alias for wire compatibility; when both headers are present, `X-DurinDoor-Token-Saver` takes precedence.

## Supported Providers

DurinDoor supports a wide fellowship of AI providers, including:

- OpenAI
- Anthropic
- Google (Gemini / Vertex AI)
- Azure OpenAI
- Mistral
- Cohere
- Groq
- Together AI
- OpenRouter
- Replicate
- And more through custom configuration

Check the dashboard **Providers** page for the full list and connection instructions.

## Model catalog

Provider model catalogs live in `open-sse/providers/registry/*.js` (one file per
provider, transport + models co-located). The runtime `PROVIDER_MODELS` map is
built from that registry by `open-sse/providers/index.js` and re-exported through
`open-sse/config/providerModels.js` (which also adds lookup helpers) — **never edit
either to add a model**; append to the relevant registry file instead. Model-array
order is behavior (the default model is `models[0]`), so new entries are appended,
never reordered.

The catalog tool keeps the catalog honest across the three trees we track
(`origin` = DurinDoor, `upstream` = 9router, `omniroute` = OmniRoute):

```bash
# Mode 1 — local consistency audit (npm script; local-only, needs no extra remotes):
# duplicate ids, empty ids, orphan upstreamModelId, bad targetFormat, orphan pricing rows.
# Exits non-zero on findings.
npm run catalog:diff

# Mode 2 — cross-tree comparison report (direct node invocation; needs the
# upstream + omniroute refs fetched):
node scripts/model-catalog-diff.mjs --upstream-ref upstream/master --omniroute-ref omniroute/main
# → writes model-catalog-report.md (commit-SHA pinned; review only, never auto-applied)
```

The committed `model-catalog-report.md` records the exact commit SHAs compared and
a per-provider `model id | ours | upstream | omniroute` table plus a "missing here"
summary; regenerate it after each catalog refresh.

## Migrating from durindoor

DurinDoor honors the legacy realm. If you have existing data in `<<~/.durindoor>>`, DurinDoor will detect and use it on first run; your configuration, accounts, and usage history will be preserved.

No manual intervention is required: start DurinDoor and your existing gates will be preserved.

## Contributing

We welcome travelers and tinkerers. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard so the changelog remains clear and true.

## License

DurinDoor is released under the [MIT License](LICENSE).

## Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). We are grateful for the foundation they forged.

DurinDoor expands on that foundation with enhanced features, a new identity, and a focus on keeping the doors of your AI stack open.
