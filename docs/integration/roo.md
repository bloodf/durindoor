# Roo Integration

Roo can use DurinDoor through an OpenAI-compatible or custom provider configuration. Use DurinDoor for routing, provider fallback, and usage tracking while Roo keeps one stable model name.

## Configuration

```text
Provider: OpenAI-compatible or custom provider
Base URL: http://localhost:20128/v1
API key:  YOUR_DURINDOOR_API_KEY
Model:    coding-default
```

If Roo asks for an Ollama-style endpoint, use the same DurinDoor `/v1` base URL when the field accepts OpenAI-compatible routes.

## Recommended Model Strategy

Create separate combos for different Roo workflows:

| Workflow | Example combo | Notes |
| --- | --- | --- |
| Daily coding | `coding-default` | Balanced model plus reliable fallback. |
| Fast edits | `coding-fast` | Low-latency model chain. |
| Deep planning | `coding-best` | Highest capability model chain. |
| Low-cost work | `coding-low-cost` | Local or lower-cost providers first. |

## Verification

Ask Roo to send a short message, then open DurinDoor usage logs. Confirm the provider and model match the expected combo member.

## Troubleshooting

- If Roo cannot connect, verify the base URL includes `/v1`.
- If authentication fails, regenerate a DurinDoor API key.
- If tools fail, test each combo member directly.
- If a local endpoint fails from a containerized DurinDoor, check Docker networking.
