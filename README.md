# DurinDoor

DurinDoor is a self-hosted AI gateway that gives developer tools and applications one stable API in front of many upstream AI providers. It exposes OpenAI-compatible endpoints, manages provider credentials, translates request and response formats, supports fallback combos, and records usage in a local dashboard.

DurinDoor is a fork of 9Router. Some compatibility identifiers intentionally remain so existing installations can migrate safely.

## Quick Start

```bash
npm install -g durindoor
durindoor
```

Open the dashboard:

```text
http://localhost:20128/dashboard
```

Use this base URL in OpenAI-compatible clients:

```text
http://localhost:20128/v1
```

## Documentation

The canonical English documentation is plain Markdown under [`docs/`](docs/README.md). Start with:

- [Quick Start](docs/getting-started/quick-start.md)
- [Installation](docs/getting-started/installation.md)
- [Provider Connections](docs/providers/subscription.md)
- [Provider Nodes and Custom Providers](docs/providers/cheap.md)
- [Combos and Fallback](docs/features/combos.md)
- [Integrations](docs/integration/other-tools.md)
- [Deployment](docs/deployment/cloud.md)
- [Troubleshooting](docs/troubleshooting.md)

Repository-level documentation is indexed in [`docs/README.md`](docs/README.md).

## Core Features

- OpenAI-compatible API routes for chat, responses, messages, models, embeddings, images, audio, search, fetch, moderation, reranking, and token counting.
- Provider connections for OAuth, API key, cookie-backed, local, and compatible providers.
- Custom OpenAI-compatible and Anthropic-compatible provider nodes.
- Model aliases and combo fallback chains.
- Multi-account provider fallback.
- Request and response translation across supported provider formats.
- Usage, cost, quota, request log, and provider limit views.
- CLI tool helpers for common coding tools.
- Optional MITM, tunnel, proxy pool, token saver, and MCP gateway surfaces.

## Install from Source

```bash
git clone https://github.com/bloodf/durindoor.git
cd durindoor
npm install --no-audit --no-fund
npm run build
npm start
```

For development:

```bash
npm run dev
```

The development server uses port `20127`.

## Docker

```bash
docker run -d \
  --name durindoor \
  -p 20128:20128 \
  -e PORT=20128 \
  -e HOSTNAME=0.0.0.0 \
  -e DATA_DIR=/app/data \
  -v durindoor-data:/app/data \
  ghcr.io/bloodf/durindoor:latest
```

Read [DOCKER.md](DOCKER.md) and [Cloud and Docker Deployment](docs/deployment/cloud.md) before exposing a deployment to a network.

## Configuration

Important environment variables:

| Variable | Description |
| --- | --- |
| `PORT` | Gateway port. Default production port is `20128`. |
| `DATA_DIR` | Persistent storage directory. Default remains `~/.9router` for compatibility. |
| `JWT_SECRET` | Dashboard session signing secret. Set explicitly in production. |
| `API_KEY_SECRET` | Secret used for generated API key CRC validation. Set explicitly in production. |
| `INITIAL_PASSWORD` | Initial dashboard password. Set explicitly before remote exposure. |
| `NEXT_PUBLIC_BASE_URL` | Browser-visible base URL. |

## Migration from 9Router

Back up the existing data directory, start DurinDoor with the same or copied `DATA_DIR`, and verify providers, API keys, combos, and usage in the dashboard. The legacy data path and some names are kept intentionally for migration compatibility.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening pull requests. Use conventional commits.

## License

DurinDoor is released under the [MIT License](LICENSE).

## Acknowledgments

DurinDoor builds on [9Router](https://github.com/decolua/9router). The project keeps compatibility where it protects users during migration, while the canonical documentation and package identity now use DurinDoor.
