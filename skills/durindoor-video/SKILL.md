---
name: durindoor-video
description: Generate video through DurinDoor using the dashboard's video route or a model discovered from /v1/models/video.
---

# DurinDoor Video

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/video" | jq -r '.data[].id'
```

## Async jobs (xAI Grok Imagine, MiniMax, OrcaRouter)

Leave out `model` to use the first async-capable model in the video route (**Dashboard → Media Routes**), or pass one from discovery. Creation is a billable job, so it is never retried on another model.

```bash
curl -i -X POST "$DURINDOOR_URL/v1/videos/generations" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"waves rolling onto a beach at dusk"}'
```

The response carries `request_id` and an `x-9router-connection-id` header. Poll with that header echoed as `x-connection-id`:

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" -H "x-connection-id: $CONNECTION_ID" \
  "$DURINDOOR_URL/v1/videos/$REQUEST_ID"
```

A finished job includes `video.url`.

## Synchronous generation

`POST /v1/video/generations` takes `{ model?, prompt }` and returns the finished video. Without `model` it tries the route's models it can run, in order.

If no connected provider serves video, the response is HTTP 400 with `error.code` set to `no_provider_for_kind`.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.mdx
