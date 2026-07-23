# DurinDoor Agent Skills

These skills teach compatible AI agents how to discover and call a running DurinDoor gateway.

Start with the entry skill, then load the capability skill needed for the request.

| Capability | Raw skill URL |
| --- | --- |
| Entry and setup | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor/SKILL.md |
| Chat | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-chat/SKILL.md |
| Image generation | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-image/SKILL.md |
| Text-to-speech | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-tts/SKILL.md |
| Speech-to-text | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-stt/SKILL.md |
| Embeddings | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-embeddings/SKILL.md |
| Web search | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-web-search/SKILL.md |
| Web fetch | https://raw.githubusercontent.com/bloodf/durindoor/refs/heads/main/skills/durindoor-web-fetch/SKILL.md |

## Setup

```bash
export DURINDOOR_URL="http://localhost:20128"
export DURINDOOR_KEY="YOUR_DURINDOOR_API_KEY"
curl "$DURINDOOR_URL/api/health"
```

Use discovery endpoints in each skill instead of copying model IDs from old examples. Available models depend on the running version and configured providers.

- [DurinDoor documentation](../docs/README.md)
- [API reference](../docs/reference/api.md)
- [Source](https://github.com/bloodf/durindoor)
