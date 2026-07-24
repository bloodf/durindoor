# Quick Start

Start DurinDoor locally and send one request through the gateway.

**Requirements:** Node.js 20.20.2, npm 10.8.2.

## 1. Install

```bash
npm install -g durindoor
```

Or run without installing:

```bash
npx durindoor
```

## 2. Start the gateway

```bash
durindoor
```

Default URLs:

| Surface | URL |
|---|---|
| Dashboard | http://localhost:20128/dashboard |
| API base | http://localhost:20128/v1 |
| Health check | http://localhost:20128/api/health |

On first run, DurinDoor creates `DATA_DIR` and initializes the database. Sign in with the `INITIAL_PASSWORD` set in your environment, or the local default if none was set. Change the password before exposing the instance.

## 3. Add a provider

Open the dashboard → Providers. Add at least one connection:

| Provider type | Credential |
|---|---|
| OAuth | Browser login, device code, or OAuth callback |
| API key | Provider API key or token |
| Compatible endpoint | OpenAI-compatible or Anthropic-compatible URL |
| Local provider | Local URL, no remote account |

## 4. Create a DurinDoor API key

Dashboard → Settings or Endpoint → API Keys → Create Key.

Use this key in client tools. New keys have the shape `sk-<machine>-<key>-<crc>`. Older `sk-*` keys remain supported.

## 5. Send a test request

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

Replace `MODEL_ID` with a model from your dashboard.

## 6. Connect a tool

OpenAI-compatible clients:

```text
Base URL: http://localhost:20128/v1
API key:  your DurinDoor API key
Model:    a model ID, alias, or combo name from the dashboard
```

For Claude-compatible clients, use the integration-specific guide because some tools expect `ANTHROPIC_BASE_URL`.

## 7. Create a combo

Dashboard → Combos → Create. Name it, add two or more models in priority order, then send requests with that combo name as the model.

## Next steps

- [Installation](installation.md) — production configuration and data paths
- [Usage Guide](../guides/usage.md) — dashboard workflow and SDK examples
- [Combos and Fallback](../features/combos.md) — routing strategy
- [API Reference](../reference/api.md) — supported endpoints
- [Troubleshooting](../troubleshooting.md) — if the first request fails
