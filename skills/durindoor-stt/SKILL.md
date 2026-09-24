---
name: durindoor-stt
description: Transcribe audio through DurinDoor using a model discovered from /v1/models/stt.
---

# DurinDoor Speech-to-Text

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/stt" | jq -r '.data[].id'
MODEL_ID="$(curl -s -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/stt" | jq -r '.data[0].id')"
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

## Transcribe

```bash
curl -X POST "$DURINDOOR_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -F "model=$MODEL_ID" \
  -F "file=@audio.mp3" \
  -F "language=en"
```

`file` and `model` are required. `language`, `prompt`, `temperature`, and response formats depend on the discovered model. The default JSON response contains `text`; verbose formats may include duration and segments.

## Use the default route

Leave out `model` and DurinDoor uses the speech-to-text route from **Dashboard → Media Routes**, trying the fallbacks in order.

```bash
curl -X POST "$DURINDOOR_URL/v1/audio/transcriptions" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -F "file=@audio.mp3"
```

If no connected provider serves this endpoint, the response is HTTP 400 with `error.code` set to `no_provider_for_kind`. Connect a provider, or pass `model`.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.mdx
