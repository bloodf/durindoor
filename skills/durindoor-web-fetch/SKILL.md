---
name: durindoor-web-fetch
description: Fetch a URL through DurinDoor with a webFetch model discovered from /v1/models/web.
---

# DurinDoor Web Fetch

## Discover

```bash
curl "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webFetch") | .id'
MODEL_ID="$(curl -s "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webFetch") | .id' | head -n1)"
curl "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Fetch

```bash
curl -X POST "$DURINDOOR_URL/v1/web/fetch" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"url\":\"https://example.com\",\"format\":\"markdown\"}"
```

`model` and `url` are required. Formats, truncation, rendering, and extraction options depend on the selected provider. The normalized response contains URL, title, content, metadata, usage, and metrics.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
