![DurinDoor](public/durindoor-logo.png)

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
- [Migrating from 9router](#migrating-from-9router)
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
http://localhost:11434
```

From the dashboard, add providers, create an API key, and point your tools at `http://localhost:11434/v1`.

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
  -p 11434:11434 \
  -e PORT=11434 \
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
| `PORT` | `11434` | HTTP port the gateway listens on. |
| `HOSTNAME` | `0.0.0.0` | Network interface to bind. |
| `DATA_DIR` | `~/.durindoor` | Persistent storage directory. |
| `MCP_GATEWAY_OAUTH_PUBLIC_URL` | — | Public URL used for MCP Gateway OAuth callbacks. |
| `NODE_ENV` | `production` | Runtime environment (`development` or `production`). |
| `NEXT_PUBLIC_BASE_URL` | `http://localhost:11434` | Public base URL of the dashboard. |

Run `durindoor --help` to see all CLI options and flags.

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

## Migrating from 9router

DurinDoor honors the legacy realm. If you have existing data in `~/.9router`, DurinDoor will detect it on first run and migrate your configuration, accounts, and usage history automatically into the new `~/.durindoor` storage.

No manual intervention is required: start DurinDoor and your existing gates will be preserved.

## Contributing

We welcome travelers and tinkerers. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) standard so the changelog remains clear and true.

## License

DurinDoor is released under the [MIT License](LICENSE).

## Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). We are grateful for the foundation they forged.

DurinDoor expands on that foundation with enhanced features, a new identity, and a focus on keeping the doors of your AI stack open.
