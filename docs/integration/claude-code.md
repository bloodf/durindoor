# Claude Code Integration

Claude Code can use DurinDoor through Anthropic-compatible environment variables. DurinDoor receives the request, resolves the selected model or combo, and forwards it to the configured upstream provider.

## Prerequisites

- DurinDoor running locally or behind a reachable URL.
- A DurinDoor API key.
- At least one chat-capable provider or combo.
- Claude Code installed.

## Local Configuration

Set the Anthropic base URL and auth token:

```bash
export ANTHROPIC_BASE_URL="http://localhost:20128/v1"
export ANTHROPIC_AUTH_TOKEN="YOUR_DURINDOOR_API_KEY"
```

Then choose a model or combo:

```bash
claude --model coding-default "Summarize this repository."
```

## Default Model Aliases

Claude Code supports environment variables for default model aliases. Point them at DurinDoor model IDs or combo names:

```bash
export ANTHROPIC_DEFAULT_OPUS_MODEL="coding-best"
export ANTHROPIC_DEFAULT_SONNET_MODEL="coding-default"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="coding-fast"
```

Use stable combo names when you want to change routing in DurinDoor without changing shell configuration.

## Dashboard Helper

The dashboard includes CLI tool helpers for Claude Code. Use `Dashboard -> CLI Tools -> Claude Code` to copy current endpoint, API key, and model settings.

## Verification

```bash
curl http://localhost:20128/v1/messages \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "coding-default",
    "max_tokens": 64,
    "messages": [{"role": "user", "content": "Say hello."}]
  }'
```

If this succeeds but Claude Code fails, check local Claude Code settings and environment variables.

## Notes

- Some Claude-specific request features require translation when the upstream is not Anthropic-compatible.
- Tool use and multimodal content should be tested with the exact model chain you plan to use.
- If Claude Code reports authentication errors, confirm `ANTHROPIC_AUTH_TOKEN` contains the DurinDoor API key, not the upstream provider key.
