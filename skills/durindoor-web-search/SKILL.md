---
name: durindoor-web-search
description: Search the web through DurinDoor with a webSearch model discovered from /v1/models/web.
---

# DurinDoor Web Search

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webSearch") | .id'
MODEL_ID="$(curl -s -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webSearch") | .id' | head -n1)"
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Search

```bash
curl -X POST "$DURINDOOR_URL/v1/search" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"query\":\"DurinDoor documentation\",\"max_results\":5}"
```

Optional country, language, time range, domain filter, search type, and provider options depend on the discovered model. The response includes normalized `results`, usage, metrics, and errors.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
