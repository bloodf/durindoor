---
name: durindoor-embeddings
description: Generate vector embeddings through DurinDoor using a model discovered from /v1/models/embedding.
---

# DurinDoor Embeddings

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/embedding" | jq -r '.data[].id'
MODEL_ID="$(curl -s -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/embedding" | jq -r '.data[0].id')"
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Embed text

```bash
curl -X POST "$DURINDOOR_URL/v1/embeddings" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"input\":[\"hello\",\"world\"]}"
```

`input` accepts a string or array. Optional dimensions, encoding format, and batch limits depend on the selected model. The response uses OpenAI-compatible `data[].embedding` arrays.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
