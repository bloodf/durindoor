---
name: durindoor-image
description: Generate images through DurinDoor with a model discovered from /v1/models/image.
---

# DurinDoor Image Generation

## Discover

```bash
curl "$DURINDOOR_URL/v1/models/image" | jq -r '.data[].id'
MODEL_ID="$(curl -s "$DURINDOOR_URL/v1/models/image" | jq -r '.data[0].id')"
curl "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Generate

```bash
curl -X POST "$DURINDOOR_URL/v1/images/generations?response_format=binary" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"prompt\":\"watercolor mountains at sunrise\"}" \
  --output out.png
```

Required fields are `model` and `prompt`. Optional fields such as `n`, `size`, `quality`, `style`, images, or output format depend on the selected model. Inspect `/v1/models/info?id=...` before sending provider-specific fields.

JSON responses use OpenAI-compatible `data[].url` or `data[].b64_json`. The binary response mode returns image bytes.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
