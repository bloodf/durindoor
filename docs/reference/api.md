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

## Models

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

The response contains models available through configured providers, aliases, compatible nodes, and media providers.

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

Fetch:

```bash
curl http://localhost:20128/v1/web/fetch \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com"
  }'
```

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
