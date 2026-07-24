---
name: durindoor-tts
description: Convert text to speech through DurinDoor using a model discovered from /v1/models/tts.
---

# DurinDoor Text-to-Speech

## Discover

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/tts" | jq -r '.data[].id'
MODEL_ID="$(curl -s -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/tts" | jq -r '.data[0].id')"
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/models/info?id=$MODEL_ID"
```

Some providers expose voices separately:

```bash
curl -H "Authorization: Bearer $DURINDOOR_KEY" "$DURINDOOR_URL/v1/audio/voices?provider=edge-tts" | jq -r '.data[].model'
```

Use the exact model or voice ID returned by discovery. Do not add a provider prefix unless the response includes it.

## Generate audio

```bash
curl -X POST "$DURINDOOR_URL/v1/audio/speech" \
  -H "Authorization: Bearer $DURINDOOR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL_ID\",\"input\":\"Hello world\"}" \
  --output speech.mp3
```

The default response is raw audio. Use `?response_format=json` for base64 JSON when supported.

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
