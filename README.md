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

[![npm](https://img.shields.io/npm/v/durindoor.svg)](https://www.npmjs.com/package/durindoor)
[![License](https://img.shields.io/github/license/bloodf/durindoor.svg)](https://github.com/bloodf/durindoor/blob/main/LICENSE)
[![Stars](https://img.shields.io/github/stars/bloodf/durindoor.svg)](https://github.com/bloodf/durindoor/stargazers)
[![CI](https://img.shields.io/github/actions/workflow/status/bloodf/durindoor/ci.yml?branch=main)](https://github.com/bloodf/durindoor/actions)

DurinDoor is a self-hosted AI gateway. Run it on your machine or server, add provider credentials once, then route every OpenAI-compatible client through one local endpoint with unified usage tracking, provider combos, and request logs.

## Capabilities

- [Chat and responses](docs/getting-started/quick-start.md) — OpenAI-compatible chat, responses, and completions.
- [Embeddings](docs/providers/cheap.md) — Route embedding requests to any configured provider.
- [Images](docs/getting-started/quick-start.md) — Generate and edit images through providers that support image models.
- [Audio](docs/getting-started/quick-start.md) — Text-to-speech, transcription, and translation through one API.
- [Web tools](docs/guides/usage.md) — Built-in web search and web fetch routes.
- [MCP Gateway](docs/features/mcp-gateway.md) — Expose Model Context Protocol servers behind managed keys and routes.
- [Combos and fallback](docs/features/combos.md) — Chain providers so a failed request retries on the next configured model.
- [Usage tracking](docs/features/quota-tracking.md) — Request logs, cost estimates, and provider limits in the dashboard.

## Quick Start

Install the DurinDoor CLI globally and start the gateway:

```bash
npm install --global durindoor
durindoor
```

Open the dashboard and create your first API key:

```
http://localhost:20128/dashboard
```

Then point any OpenAI-compatible tool at `http://localhost:20128/v1` using that key.

## Installation

- [npm / CLI quick start](docs/getting-started/quick-start.md)
- [Docker and source installation](docs/getting-started/installation.md)
- [Usage guide](docs/guides/usage.md)

## Documentation

- **Users** — [docs/README.md#users](docs/README.md#users)
- **Operators** — [docs/README.md#operators](docs/README.md#operators)
- **Contributors** — [docs/README.md#contributors](docs/README.md#contributors)
- **API & Reference** — [docs/README.md#api--reference](docs/README.md#api--reference)

## Compatibility

DurinDoor is a fork of [9router](https://github.com/decolua/9router). Existing data under `~/.9router`, legacy API keys, and the compatibility headers `X-9Router-*` remain supported so prior installations can migrate without losing data.

## Project

- [Security](.github/SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
- [Acknowledgments](#acknowledgments)

## Acknowledgments

DurinDoor is a fork of [9router](https://github.com/decolua/9router), created by [decolua](https://github.com/decolua). The gateway builds on that foundation with a new identity, enhanced features, and an emphasis on keeping the doors of your AI stack open.
