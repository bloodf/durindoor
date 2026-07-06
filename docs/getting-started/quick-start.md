# Quick Start

This guide starts DurinDoor locally and sends one OpenAI-compatible request through the gateway.

## 1. Install

Install the CLI package globally:

```bash
npm install -g durindoor
```

DurinDoor also keeps the legacy `9router` binary alias for migration compatibility, but new documentation uses `durindoor`.

## 2. Start the Gateway

```bash
durindoor
```

The server listens on `http://localhost:20128` by default. The dashboard is available at:

```text
http://localhost:20128/dashboard
```

On first run, DurinDoor creates a data directory, initializes the local database, and prepares dashboard authentication. If the dashboard asks for a password, use the configured `INITIAL_PASSWORD` or the local default, then change it before exposing the instance to a network.

## 3. Add a Provider

Open the dashboard and add at least one provider connection.

| Provider type | Dashboard path | Credential type |
| --- | --- | --- |
| OAuth provider | Providers, then Connect | Browser login, device code, or OAuth callback |
| API key provider | Providers, then Add API Key | Provider API key or token |
| Compatible provider node | Provider Nodes | OpenAI-compatible or Anthropic-compatible endpoint |
| Local provider | Media Providers or Provider Nodes | Local URL, no remote account if the service supports it |

After saving, use the provider test action when available. A connection must be active before model requests can succeed.

## 4. Create a DurinDoor API Key

Create a client API key in the dashboard:

```text
Dashboard -> Settings or Endpoint -> API Keys -> Create Key
```

Use this key in client tools. New keys have the shape `sk-<machine>-<key>-<crc>`. Older `sk-*` keys remain supported for compatibility.

## 5. Send a Test Request

Replace `YOUR_DURINDOOR_API_KEY` and `MODEL_ID` with values from your dashboard.

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "messages": [
      {"role": "user", "content": "Reply with one short sentence."}
    ]
  }'
```

If the request succeeds, DurinDoor is ready for CLI tools and applications.

## 6. Connect a Tool

Use this generic configuration for OpenAI-compatible clients:

```text
Base URL: http://localhost:20128/v1
API key:  your DurinDoor API key
Model:    a model ID, alias, or combo name from the dashboard
```

For Claude-compatible clients, use the integration-specific guide because some tools expect Anthropic environment variable names.

## 7. Create a Combo

A combo gives client tools one stable model name while DurinDoor handles fallback.

```text
Dashboard -> Combos -> Create
Name: coding-default
Models:
  1. primary model
  2. backup model
  3. last-resort model
```

Then send requests with `"model": "coding-default"`.

## Next Steps

- Read [Installation](installation.md) for production configuration and data paths.
- Read [Provider Connections](../providers/subscription.md) for credential types.
- Read [Combos and Fallback](../features/combos.md) for routing strategy.
- Read [Troubleshooting](../troubleshooting.md) if the first request fails.
