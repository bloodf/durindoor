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

## Model Discovery Compatibility

Claude Code sends `GET /v1/models` with an `anthropic-version` header. DurinDoor keeps that endpoint and projects routable IDs as reversible `claude-<provider>/<model>` names so non-Anthropic providers appear in Claude Code's picker. A `[1m]` suffix is advertised only when DurinDoor's existing model-limit resolver proves a context window of at least 1,048,576 tokens.

Messages requests decode only IDs DurinDoor can route. Unknown official `claude-*` names and exact configured IDs remain unchanged. When Claude Code adds a recognized trailing `[1m]`, DurinDoor removes the routing annotation before model, combo, and API-key resolution while preserving the original spelling in Anthropic `message_start.message.model` response metadata. The `anthropic-beta` header remains untouched and continues to carry the 1M capability request upstream.

This ports the compatibility boundary from open upstream PRs decolua/9router#3595, #3691, and #3693 without their separate context store, per-request DB index rebuild, dashboard/statistics rewrite, or deploy tooling.

## Claude Code 2.1.258 and Claude Fable 5.1

Use Claude Code 2.1.258 or newer for Fable 5.1. DurinDoor identifies the Claude Code transport as `claude-code/2.1.258`, exposes `cc/claude-fable-5-1` for Claude Code OAuth and `anthropic/claude-fable-5-1` for Anthropic API keys, and keeps the retained Fable 5 IDs available. The `fable` default alias (`ANTHROPIC_DEFAULT_FABLE_MODEL`) is `cc/claude-fable-5-1`; Opus remains `cc/claude-opus-5`. There is no `claude-opus-5-1`.

Fable 5.1 has a 1,000,000-token context window, 128,000-token output limit, vision, search, and always-on adaptive thinking. It preserves forced Claude-native tool choices such as `{ type: "tool", name: "record_summary" }`; do not downgrade that choice during translation.

Source: [Anthropic Claude Code release notes](https://docs.claude.com/en/release-notes/claude-code).

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
