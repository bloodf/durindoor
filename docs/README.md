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

DurinDoor is a self-hosted AI gateway for developer tools, scripts, and applications that need one stable OpenAI-compatible API in front of many AI providers. It stores provider credentials locally, routes requests to upstream services, and records usage so operators can see what was used and why.

DurinDoor is a fork of 9router. Some compatibility names remain intentionally visible in storage paths, API key formats/prefixes, and internal headers so existing installations can migrate without losing data.

This repository is the canonical source for DurinDoor documentation. There is no separate documentation website; GitHub-rendered Markdown is the source of truth.

## Users

For users getting their first request through the gateway.

- [Quick Start](getting-started/index.mdx): install, start, create an API key, and send the first request.
- [Installation](getting-started/installation.mdx): npm, source, Docker, configuration, upgrades, and data paths.
- [Guides](guides/index.mdx): [API keys](guides/api-keys.mdx), [models and aliases](guides/models-and-aliases.mdx), [SDK examples](guides/sdk-examples.mdx), and [monitoring](guides/monitoring-usage.mdx).
- [Provider Connections](providers/connecting-accounts.mdx): OAuth, API key, cookie, and account-based providers.
- [Provider Nodes and Custom Providers](providers/openai-compatible-nodes.mdx): OpenAI-compatible nodes, Anthropic-compatible nodes, custom embeddings, and provider aliases.
- [Free and Local Providers](providers/free-and-local.mdx): no-auth, local, browser-cookie, and local-device providers.
- [Claude Code](integrations/claude-code.mdx)
- [Ollama + Claude Code](integrations/ollama-claude.mdx)
- [OpenAI Codex](integrations/codex.mdx)
- [Cursor](integrations/cursor.mdx)
- [Cline](integrations/cline.mdx)
- [Roo](integrations/roo.mdx)
- [Continue](integrations/continue.mdx)
- [Other OpenAI-Compatible Tools](integrations/other-tools.mdx)
- [Combos and Fallback](features/combos.mdx): ordered model chains, retry behavior, exclusions, and operating patterns.
- [Smart Routing](features/smart-routing.mdx): model resolution, provider selection, account fallback, and format translation.
- [FAQ](faq.md)
- [Troubleshooting](troubleshooting.md)

## Operators

For operators running DurinDoor in production or on a team server.

- [Laptop](deployment/localhost.mdx)
- [Docker](deployment/docker.mdx)
- [VPS and cloud](deployment/cloud.mdx)
- [Reverse proxy and static assets](deployment/reverse-proxy-and-static-assets.mdx)
- [Startup and Runtime Operations](operations/startup.mdx)
- [Upgrading DurinDoor](operations/upgrading.mdx)
- [Data Management and Backup](operations/data-management.mdx)
- [Security and Production Hardening](operations/security.mdx)
- [API key scoping](operations/api-key-scoping.mdx)
- [Usage and Quota Tracking](features/quota-tracking.mdx)
- [Proxy Timeline](features/proxy-timeline.mdx)
- [MCP Gateway](features/mcp-gateway.mdx)
- [Realtime Behavior](features/realtime.mdx)
- [Compression](features/compression.mdx)
- [Headroom Setup and Diagnostics](features/headroom.mdx)
- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)

## Contributors

For developers working on the DurinDoor codebase, provider registry, or documentation.

- [Contributing](development/contributing.md)
- [Local Development](development/local-development.md)
- [Provider Brand Assets](development/provider-brand-assets.md) — provider-logo policy and provenance.
- [Architecture](ARCHITECTURE.md)
- [Upstream Sync Watch](UPSTREAM_SYNC.md)
- [tests/README.md](../tests/README.md)
- [DurinDoor omp Extension](../omp-extension/README.md)

## API & Reference


For stable lookup pages for routes, environment variables, compatibility, and runtime behavior.

- [API Reference](reference/api.mdx)
- [Environment Variables](reference/environment.md)
- [Provider Plugin Manifest](reference/provider-plugin-manifest.md)
- [Model Limits and Context Enforcement](reference/model-limits.md)
- [MCP Gateway](features/mcp-gateway.mdx)
- [Realtime Behavior](features/realtime.mdx)
- [Compression](features/compression.mdx)
- [Local Router Providers](providers/local-router-providers.mdx)
- [Compatibility and Migration](#compatibility)
- [Architecture](ARCHITECTURE.md)

## Package Documentation

- [cli/README.md](../cli/README.md)
- [skills/README.md](../skills/README.md)

## Community and Project

- [Security](../.github/SECURITY.md)
- [Contributing](../CONTRIBUTING.md)
- [Code of Conduct](../CODE_OF_CONDUCT.md)
- [Changelog](../CHANGELOG.md)
- [License](../LICENSE)
- [Acknowledgments](../README.md#acknowledgments)

## Core Concepts

| Term | Definition |
| --- | --- |
| Gateway | The DurinDoor server process. It receives client requests and forwards them to upstream providers. |
| Dashboard | The browser UI used to manage providers, API keys, combos, usage, tunnels, and integrations. |
| Provider | A configured upstream service such as OpenAI, Anthropic, Gemini, Ollama, Kiro, Codex, or an OpenAI-compatible endpoint. |
| Connection | A credential set for one provider. A provider can have multiple connections for account fallback. |
| Provider node | A custom OpenAI-compatible or Anthropic-compatible endpoint added by the user. |
| Model identifier | The string sent by clients in the `model` field. It can be a provider model such as `openai/gpt-4.1`, an alias, or a combo name. |
| Combo | An ordered fallback chain of models. DurinDoor tries each member until one succeeds or the chain is exhausted. |
| API key | A DurinDoor-issued key used by client tools. New keys use the `sk-<machine>-<key>-<crc>` shape. |
| Data directory | Persistent storage directory. The default remains `~/.9router` for compatibility unless `DATA_DIR` is set. |
| MITM proxy | Optional local interception layer for supported IDE traffic. It requires explicit setup and local trust changes. |
| MCP Gateway | A DurinDoor gateway that exposes MCP servers behind managed keys and routes. |

## Default Endpoints

| Surface | URL |
| --- | --- |
| Dashboard | `http://localhost:20128/dashboard` |
| API base | `http://localhost:20128/v1` |
| Health check | `http://localhost:20128/api/health` |
| Development server | `http://localhost:20127` when running `npm run dev` |

## Supported API Families

DurinDoor includes routes for chat, responses, messages, models, embeddings, image generation, image edits, speech, transcription, translation, moderation, reranking, web search, web fetch, and token counting. Availability depends on the selected upstream provider and configured credentials.

## Compatibility

DurinDoor is a fork of [9router](https://github.com/decolua/9router). These compatibility names remain supported:

- Storage path `~/.9router` (use `DATA_DIR` to override).
- Legacy API keys in the `sk-<8 hex>` shape and current keys in the `sk-<machineId>-<keyId>-<crc8>` shape.
- Internal headers prefixed with `X-9Router-` and their `X-DurinDoor-` equivalents.

## Operator Essentials

- Use [Environment Variables](reference/environment.md) before deploying outside localhost.
- Use [Startup and Runtime Operations](operations/startup.mdx) for process management, health checks, and smoke tests.
- Use [Security and Production Hardening](operations/security.mdx) before exposing a dashboard, tunnel, or reverse proxy.
- Use [API Reference](reference/api.mdx) when integrating SDKs, scripts, or custom clients.
- Use [Contributing](development/contributing.md) before opening pull requests.

## Documentation Language Policy

Project documentation Markdown is English-only. Use the English files under this directory as the canonical source for any external or autonomous translation workflow, but do not commit generated non-English documentation back into the repository.

Non-English language assets belong in the web UI localization layer, such as `public/i18n` and `src/i18n`, not in project documentation files.
