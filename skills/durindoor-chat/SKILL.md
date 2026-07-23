---
name: durindoor-chat
description: Send chat and code-generation requests through DurinDoor using OpenAI or Anthropic request formats.
---

# DurinDoor Chat

Requires `DURINDOOR_URL` and, when enabled, `DURINDOOR_KEY`.

## Discover

```bash
curl "$DURINDOOR_URL/v1/models" | jq -r '.data[].id'
MODEL_ID="$(curl -s "$DURINDOOR_URL/v1/models" | jq -r '.data[0].id')"
```

## OpenAI format

```bash
curl -X POST "$DURINDOOR_URL/v1/chat/completions" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}],\"stream\":false}"
```

For streaming, set `stream:true` and consume SSE until `data: [DONE]`.

## Anthropic format

```bash
curl -X POST "$DURINDOOR_URL/v1/messages" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"max_tokens\":1024,\"messages\":[{\"role\":\"user\",\"content\":\"Hi\"}]}"
```

Use only a model or combo returned by discovery. Provider availability changes with connections and gateway version.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
