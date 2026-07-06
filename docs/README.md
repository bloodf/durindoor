# DurinDoor Documentation

DurinDoor is a self-hosted AI gateway for developer tools, scripts, and applications that need one stable API in front of many AI providers. It exposes OpenAI-compatible endpoints, stores provider credentials locally, routes requests to upstream providers, and records usage so operators can see what was used and why.

DurinDoor is a fork of 9Router. Some compatibility names remain intentionally visible in storage paths, API key prefixes, CLI aliases, and internal headers so existing installations can migrate without losing data.

## Documentation Index

### Getting Started

- [Quick Start](getting-started/quick-start.md): install, start, create an API key, and send the first request.
- [Installation](getting-started/installation.md): npm, source, Docker, configuration, upgrades, and data paths.
- [Usage Guide](guides/usage.md): dashboard workflow, API keys, model selection, combos, SDK examples, and monitoring.

### Providers

- [Provider Connections](providers/subscription.md): OAuth, API key, cookie, and account-based providers.
- [Provider Nodes and Custom Providers](providers/cheap.md): OpenAI-compatible nodes, Anthropic-compatible nodes, custom embeddings, and provider aliases.
- [Free and Local Providers](providers/free.md): no-auth, local, browser-cookie, and local-device providers.

### Features

- [Smart Routing](features/smart-routing.md): model resolution, provider selection, account fallback, and format translation.
- [Combos and Fallback](features/combos.md): ordered model chains, retry behavior, exclusions, and operating patterns.
- [Usage and Quota Tracking](features/quota-tracking.md): request logs, cost estimates, provider limits, and reset windows.

### Integrations

- [Claude Code](integration/claude-code.md)
- [OpenAI Codex](integration/codex.md)
- [Cursor](integration/cursor.md)
- [Cline](integration/cline.md)
- [Roo](integration/roo.md)
- [Continue](integration/continue.md)
- [Other OpenAI-Compatible Tools](integration/other-tools.md)

### Deployment and Operations

- [Local Deployment](deployment/localhost.md)
- [Cloud and Docker Deployment](deployment/cloud.md)
- [Startup and Runtime Operations](operations/startup.md)
- [Security and Production Hardening](operations/security.md)
- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)

### Reference

- [Environment Variables](reference/environment.md)
- [API Reference](reference/api.md)
- [Architecture](ARCHITECTURE.md)
- [MCP Gateway Notes](pr-mcp-gateway.md)

### Development

- [Contributing](development/contributing.md)
- [Local Development](development/local-development.md)

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

DurinDoor includes routes for chat, responses, messages, models, embeddings, image generation, image edits, speech, transcription, translation, moderation, reranking, web search, web fetch, and token counting. Availability still depends on the selected upstream provider and configured credentials.

## Operator Essentials

- Use [Environment Variables](reference/environment.md) before deploying outside localhost.
- Use [Startup and Runtime Operations](operations/startup.md) for process management, health checks, and smoke tests.
- Use [Security and Production Hardening](operations/security.md) before exposing a dashboard, tunnel, or reverse proxy.
- Use [API Reference](reference/api.md) when integrating SDKs, scripts, or custom clients.
- Use [Contributing](development/contributing.md) before opening pull requests.

## Documentation Language Policy

Project documentation Markdown is English-only. Use the English files under this directory as the canonical source for any external or autonomous translation workflow, but do not commit generated non-English documentation back into the repository.

Non-English language assets belong in the web UI localization layer, such as `public/i18n` and `src/i18n`, not in project documentation files.
