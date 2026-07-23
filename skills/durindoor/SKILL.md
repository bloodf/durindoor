---
name: durindoor
description: Set up and discover capabilities on a DurinDoor AI gateway. Use when the user mentions DurinDoor, DURINDOOR_URL, or needs a capability-specific DurinDoor skill.
---

# DurinDoor

## Setup

```bash
export DURINDOOR_URL="http://localhost:20128"
export DURINDOOR_KEY="YOUR_DURINDOOR_API_KEY"
curl "$DURINDOOR_URL/api/health"
```

Send authenticated requests with `Authorization: Bearer $DURINDOOR_KEY`. Omit the header only when the gateway explicitly allows unauthenticated requests.

## Discover models

```bash
curl "$DURINDOOR_URL/v1/models"             # chat and combos
curl "$DURINDOOR_URL/v1/models/image"       # image generation
curl "$DURINDOOR_URL/v1/models/tts"         # text-to-speech
curl "$DURINDOOR_URL/v1/models/stt"         # speech-to-text
curl "$DURINDOOR_URL/v1/models/embedding"   # embeddings
curl "$DURINDOOR_URL/v1/models/web"         # web search and fetch; inspect kind
curl "$DURINDOOR_URL/v1/models/rerank"      # reranking
```

Use a returned `data[].id` as the request's `model`. Web entries identify `kind` as `webSearch` or `webFetch`. `/v1/models/web` discovers models; requests go to `POST /v1/search` or `POST /v1/web/fetch`.

## Capability skills

- Chat: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-chat/SKILL.md
- Images: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-image/SKILL.md
- TTS: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-tts/SKILL.md
- STT: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-stt/SKILL.md
- Embeddings: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-embeddings/SKILL.md
- Web search: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-web-search/SKILL.md
- Web fetch: https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-web-fetch/SKILL.md

Reference: https://github.com/bloodf/durindoor/blob/main/docs/reference/api.md
