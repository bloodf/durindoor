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

- [Quick Start](getting-started/quick-start.md): install, start, create an API key, and send the first request.
- [Installation](getting-started/installation.md): npm, source, Docker, configuration, upgrades, and data paths.
- [Usage Guide](guides/usage.md): dashboard workflow, API keys, model selection, combos, SDK examples, and monitoring.
- [Provider Connections](providers/subscription.md): OAuth, API key, cookie, and account-based providers.
- [Provider Nodes and Custom Providers](providers/cheap.md): OpenAI-compatible nodes, Anthropic-compatible nodes, custom embeddings, and provider aliases.
- [Free and Local Providers](providers/free.md): no-auth, local, browser-cookie, and local-device providers.
- [Claude Code](integration/claude-code.md)
- [Ollama + Claude Code](integration/ollama-claude.md)
- [OpenAI Codex](integration/codex.md)
- [Cursor](integration/cursor.md)
- [Cline](integration/cline.md)
- [Roo](integration/roo.md)
- [Continue](integration/continue.md)
- [Other OpenAI-Compatible Tools](integration/other-tools.md)
- [Combos and Fallback](features/combos.md): ordered model chains, retry behavior, exclusions, and operating patterns.
- [Smart Routing](features/smart-routing.md): model resolution, provider selection, account fallback, and format translation.
- [FAQ](faq.md)
- [Troubleshooting](troubleshooting.md)

## Operators

For operators running DurinDoor in production or on a team server.

- [Local Deployment](deployment/localhost.md)
- [Docker](../DOCKER.md)
- [Cloud and Docker Deployment](deployment/cloud.md)
- [Static Assets and Reverse Proxy](deployment/static-assets.md)
- [Startup and Runtime Operations](operations/startup.md)
- [Upgrading DurinDoor](operations/upgrading.md)
- [Data Management and Backup](operations/data-management.md)
- [Security and Production Hardening](operations/security.md)
- [Usage and Quota Tracking](features/quota-tracking.md)
- [MCP Gateway](features/mcp-gateway.md)
- [Realtime Behavior](features/realtime.md)
- [Compression](features/compression.md)
- [Troubleshooting](troubleshooting.md)
- [FAQ](faq.md)

## Contributors

For developers working on the DurinDoor codebase, provider registry, or documentation.

- [Contributing](development/contributing.md)
- [Local Development](development/local-development.md)
- [Architecture](ARCHITECTURE.md)
- [Upstream 2801/2818 Port Ledger](campaigns/upstream-2801-2818-ledger.md)
- [Upstream Sync Watch](UPSTREAM_SYNC.md)
- [Upstream + OmniRoute 2026-08-04 Ledger](campaigns/upstream-omniroute-2026-08-04-ledger.md)
- [Upstream + OmniRoute 2026-08-09 Ledger](campaigns/upstream-omniroute-2026-08-09-ledger.md)
- [Upstream A2-b Runtime-Correctness Ports Ledger](campaigns/upstream-a2b-ports-ledger.md)
- [Upstream A2-c Responses Lite Ledger](campaigns/upstream-a2c-responses-lite-ledger.md)
- [Upstream D1 PR Ports Ledger](campaigns/upstream-d1-pr-ports-ledger.md)
- [Upstream D2/D3 PR Ports Ledger](campaigns/upstream-d2d3-pr-ports-ledger.md)
- [Upstream ADOPT-NOW Remainder Ledger](campaigns/upstream-adopt-remainder-ledger.md)
- [Upstream #3204/#3210/#3213 Ports Ledger](campaigns/upstream-3204-3210-3213-ledger.md)
- [Upstream OmniRoute 2026-08-10 Ledger](campaigns/upstream-omniroute-2026-08-10-ledger.md)
- [Upstream #3171 MiMo Affinity Ledger](campaigns/upstream-3171-mimo-affinity-ledger.md)
- [Upstream #3172 Reader Cleanup Ledger](campaigns/upstream-3172-ledger.md)
- [Upstream #3169 Executor State Ledger](campaigns/upstream-3169-executor-state-ledger.md)
- [Upstream #3170 Credential Isolation Ledger](campaigns/upstream-port-3170-credential-isolation-ledger.md)
- [tests/README.md](../tests/README.md)
- [Upstream #3223 Antigravity Prompt Ledger](campaigns/upstream-3223-antigravity-prompt-ledger.md)
- [Upstream #3168 iFlow Auth Ledger](campaigns/upstream-3168-iflow-auth-ledger.md)

## API & Reference

For stable lookup pages for routes, environment variables, compatibility, and runtime behavior.

- [API Reference](reference/api.md)
- [Environment Variables](reference/environment.md)
- [Provider Plugin Manifest](reference/provider-plugin-manifest.md)
- [Model Limits and Context Enforcement](reference/model-limits.md)
- [MCP Gateway](features/mcp-gateway.md)
- [Realtime Behavior](features/realtime.md)
- [Compression](features/compression.md)
- [Local Router Providers](providers/local-router-providers.md)
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
- Use [Startup and Runtime Operations](operations/startup.md) for process management, health checks, and smoke tests.
- Use [Security and Production Hardening](operations/security.md) before exposing a dashboard, tunnel, or reverse proxy.
- Use [API Reference](reference/api.md) when integrating SDKs, scripts, or custom clients.
- Use [Contributing](development/contributing.md) before opening pull requests.

## Documentation Language Policy

Project documentation Markdown is English-only. Use the English files under this directory as the canonical source for any external or autonomous translation workflow, but do not commit generated non-English documentation back into the repository.

Non-English language assets belong in the web UI localization layer, such as `public/i18n` and `src/i18n`, not in project documentation files.
