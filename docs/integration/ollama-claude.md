# Ollama Claude transport

DurinDoor routes Claude Messages requests for `ollama` and `ollama-local` to
Ollama's native `/v1/messages` endpoint. Other client formats continue to use
the existing `/api/chat` transport.

The native route preserves Claude text, tool, thinking, redacted-thinking,
image, and document block ordering. Remote image URLs are fetched through the
existing guarded image loader and converted to inline base64 because Ollama's
Messages compatibility endpoint does not fetch image URLs. Anthropic
`cache_control` markers are removed because Ollama does not support them.

Streaming responses remain Claude SSE: every `event:` and `data:` frame is
preserved, `message_stop` is required, and an OpenAI `data: [DONE]` sentinel is
never appended. A stream that ends before `message_stop` fails instead of
being recorded as a successful truncated answer.

For local connections, the configured URL may be either an origin or a full
Ollama endpoint such as `/api/chat` or `/v1/messages`. DurinDoor uses its
origin and applies the selected runtime transport path once, preventing
duplicated endpoint suffixes.
