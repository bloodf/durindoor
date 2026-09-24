---
name: durindoor-web-fetch
description: Fetch a URL through DurinDoor with a webFetch model discovered from /v1/models/web.
---

# DurinDoor Web Fetch

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webFetch") | .id'
MODEL_ID="$(curl -s -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/web" | jq -r '.data[] | select(.kind=="webFetch") | .id' | head -n1)"
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Fetch

```bash
curl -X POST "$DURINDOOR_URL/v1/web/fetch" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"url\":\"https://example.com\",\"format\":\"markdown\"}"
```

`model` and `url` are required. Formats, truncation, rendering, and extraction options depend on the selected provider. The normalized response contains URL, title, content, metadata, usage, and metrics.

## Use the default route

Leave out `model` and `provider`, and DurinDoor uses the web fetch route from **Dashboard → Media Routes**, trying the fallbacks in order.

```bash
curl -X POST "$DURINDOOR_URL/v1/web/fetch" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","format":"markdown"}'
```

If no connected provider serves this endpoint, the response is HTTP 400 with `error.code` set to `no_provider_for_kind`. Connect a provider, or pass `model`.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.mdx
