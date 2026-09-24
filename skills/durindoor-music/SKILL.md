---
name: durindoor-music
description: Generate music through DurinDoor using the dashboard's music route or a model discovered from /v1/models/music.
---

# DurinDoor Music

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/music" | jq -r '.data[].id'
```

## Generate

Leave out `model` to use the music route from **Dashboard → Media Routes**, where fallbacks are tried in order. Or pass a model from discovery.

```bash
curl -X POST "$DURINDOOR_URL/v1/music/generations" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"calm lo-fi beat with rain"}'
```

`POST /v1/audio/music` is the same endpoint. If no connected provider serves music, the response is HTTP 400 with `error.code` set to `no_provider_for_kind`.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.mdx
