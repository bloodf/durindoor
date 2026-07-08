# Cline Integration

Cline can use DurinDoor as an OpenAI-compatible provider. The exact provider label in Cline may change by version; use the option that allows a custom base URL, API key, and model name.

## Prerequisites

- VS Code with Cline installed.
- DurinDoor running locally or remotely.
- A DurinDoor API key.
- A chat-capable model or combo.

## Configuration

Use these values in Cline:

```text
Provider: OpenAI-compatible or custom OpenAI provider
Base URL: http://localhost:20128/v1
API key:  YOUR_DURINDOOR_API_KEY
Model:    coding-default
```

If your Cline version only exposes an Ollama-compatible custom base URL field, use the same DurinDoor base URL and model name, then verify with a small prompt.

## Suggested Workflow

1. Create a combo for coding work.
2. Configure Cline with the combo name.
3. Run a small request.
4. Confirm the request appears in DurinDoor usage logs.
5. Test tool-heavy tasks before relying on a new provider chain.

## Tool Calls

Cline commonly sends tool calls and large context. Make sure every model in the combo supports the required tool-call shape. If a fallback model does not support tools, Cline may fail after fallback even though simple chat works.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connection refused | Confirm DurinDoor is running and the base URL includes `/v1`. |
| Authentication error | Use the DurinDoor API key in Cline, not the upstream provider key. |
| Tool call failure | Test with a direct model that supports tools, then adjust the combo. |
| Slow responses | Check upstream provider latency and combo fallback in request logs. |
