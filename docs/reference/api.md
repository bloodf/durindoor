# API Reference

DurinDoor exposes OpenAI-compatible and related API routes under `/v1`. Client tools should use a DurinDoor API key and a model ID, alias, or combo name from the dashboard.

Base URL:

```text
http://localhost:20128/v1
```

Remote deployments should use their HTTPS origin.

## Authentication

Send a DurinDoor API key as a bearer token:

```http
Authorization: Bearer YOUR_DURINDOOR_API_KEY
```

Use DurinDoor API keys generated in the dashboard. Do not send upstream provider keys to DurinDoor client-facing routes.

### Per-key model and lifetime policy

Dashboard API keys can carry three independent policy fields:

- `allowedModels`: canonical runtime identities the key may use. An empty array means unrestricted access; it does not mean deny all.
- `maxTokens`: a non-negative integer lifetime committed-token cap, or `null` for unlimited.
- `maxCostUsd`: a non-negative lifetime committed-cost cap, or `null` for unlimited.

Use the policy catalog returned by `GET /api/keys/policy-catalog` when building management clients. It covers chat, image, image-to-text, embedding, speech, transcription, moderation, rerank, music, video, search, and fetch models that are currently available. It excludes combos. Chat and media entries use `provider/model`; web operations use the least-privilege identities `provider/search` and `provider/fetch`. Legacy policies containing only a web provider ID remain compatible and authorize both operations for that provider.

Model aliases and provider aliases are resolved before a policy is stored and again before enforcement. Combo names are not valid `allowedModels` entries: authorize a combo through `allowedCombos`, while every concrete member selected at runtime must also satisfy the model policy.

`POST /api/keys` accepts either a `policy` object or the three policy fields at the top level. `PUT /api/keys/{id}` treats omitted fields as unchanged. Send `null` (or an empty numeric form value) to clear one cap, and send `allowedModels: []` to clear the allowlist. Malformed JSON, negative/non-finite limits, fractional token caps, invalid lists, combos, and unknown providers return 400 without changing the key.

List, detail, and update responses include policy plus committed lifetime usage, but never return the stored credential. The literal credential is returned only by a successful creation response.

Lifetime caps use committed usage: a request is rejected when the already-committed total is at or above its cap. One successful in-flight request can cross a cap; later requests are rejected. Reasoning and cache detail are counted as subsets of their canonical parent totals, not added twice. Provider-reported direct cost is authoritative when valid. Reservations and authoritative streamed accounting for every non-chat modality are completed by the quota program; until then native Gemini audio records a conservative request-token estimate without buffering its response.

## Models

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

The response contains models available through configured providers, aliases, compatible nodes, and media providers.

Model rows keep the callable `id` and standard `owned_by` values used by existing clients. DurinDoor also adds optional presentation fields: `name`, `provider_name`, `provider_alias`, and `gateway_provider`. Clients must continue sending `id` in requests; friendly names are display metadata and do not replace aliases or routing identities.

`GET /v1/models/info` already returned a registry `name`. That field stays registry-authoritative: presentation only adds `provider_name`, `provider_alias`, and `gateway_provider` and must not rewrite an existing info name (for example `cx/gpt-5.6-sol` stays `GPT 5.6 Sol`).

## Chat Completions

```bash
curl http://localhost:20128/v1/chat/completions \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID_OR_COMBO",
    "messages": [
      {"role": "user", "content": "Write a one-line summary."}
    ],
    "stream": true
  }'
```

Use this endpoint for most OpenAI-compatible chat clients.

## Responses API

```bash
curl http://localhost:20128/v1/responses \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID_OR_COMBO",
    "input": "Summarize the project in one sentence."
  }'
```

DurinDoor also includes compatibility rewrites for selected Responses-style clients.
Streaming compatibility preserves split UTF-8 payloads and final unterminated SSE events. `response.completed.usage` is included only when the upstream stream reports usage, including available reasoning-token details.

## Claude Messages

```bash
curl http://localhost:20128/v1/messages \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID_OR_COMBO",
    "max_tokens": 128,
    "messages": [
      {"role": "user", "content": "Say hello."}
    ]
  }'
```

This route is useful for Claude-compatible clients and translation testing.

## Count Tokens

```bash
curl http://localhost:20128/v1/messages/count_tokens \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_ID",
    "messages": [
      {"role": "user", "content": "Count this."}
    ]
  }'
```

Provider support varies.

## Embeddings

```bash
curl http://localhost:20128/v1/embeddings \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "EMBEDDING_MODEL_ID",
    "input": "Text to embed"
  }'
```

## Images

Text-to-image:

```bash
curl http://localhost:20128/v1/images/generations \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "IMAGE_MODEL_ID",
    "prompt": "A clean product diagram"
  }'
```

Image edits:

```text
POST /v1/images/edits
```

Use multipart request shapes expected by the selected client and provider.

## Audio

Speech:

```text
POST /v1/audio/speech
```

Transcription:

```text
POST /v1/audio/transcriptions
```

Translation:

```text
POST /v1/audio/translations
```

Voices:

```text
GET /v1/audio/voices
```

Provider-specific fields such as voice, format, and model differ by upstream.

## Web Search and Fetch

Search:

```bash
curl http://localhost:20128/v1/search \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "SEARCH_PROVIDER_OR_COMBO",
    "query": "DurinDoor AI gateway"
}'
```

Dedicated search providers can be selected with either DurinDoor's provider
IDs (`serper`, `exa`, `tavily`, `google-pse`, `linkup`, `searchapi`,
`youcom`, `searxng`, `ollama`, `perplexity`) or the OmniRoute-compatible
aliases (`serper-search`, `exa-search`, `tavily-search`,
`google-pse-search`, `linkup-search`, `searchapi-search`,
`youcom-search`, `searxng-search`, `ollama-search`,
`perplexity-search`). Google Programmable Search connections must store the
search engine ID in provider-specific `cx`; the dashboard add/edit forms expose
this as **Search Engine ID (cx)**, and blank or whitespace-only values are
rejected after trimming. SearXNG may use
`provider_options.baseUrl` for a self-hosted instance.

The model catalog advertises search providers as `<provider>/search`. The handler also accepts the historical bare provider or provider alias. API-key policies should use the catalog identity when search and fetch need separate permissions.

Fetch:

```bash
curl http://localhost:20128/v1/web/fetch \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com"
  }'
```

The model catalog advertises fetch providers as `<provider>/fetch`; the historical bare provider form remains accepted.

## Rerank and Moderation

```text
POST /v1/rerank
POST /v1/moderations
```

Use these only with providers that support the selected modality.

## Health

```bash
curl http://localhost:20128/api/health
```

Health does not require the same provider setup as model routes. Use `/v1/models` and a small chat request for end-to-end validation.

## Compatibility Notes

- A route existing does not mean every provider supports that route.
- Tool calls, image blocks, audio, and reasoning fields are provider-format sensitive.
- Combos should only mix models that can handle the client workflow.
- Use request logs to see the provider and model that actually handled a request.


## Realtime WebSocket

```text
GET /v1/realtime  (WebSocket upgrade)
```

DurinDoor exposes an OpenAI-Realtime-shaped WebSocket endpoint. Authenticate with `Authorization: Bearer YOUR_DURINDOOR_API_KEY` or the `openai-insecure-api-key.<key>` WebSocket subprotocol. The bridge supports text conversations only; requesting audio emits `modality_not_supported` and keeps the socket open. See [Realtime Behavior](../features/realtime.md) for events, validation, limits, close codes, and cleanup.

## Related Gateway Features

- [MCP Gateway](../features/mcp-gateway.md)
- [Compression](../features/compression.md)
- [Realtime Behavior](../features/realtime.md)
