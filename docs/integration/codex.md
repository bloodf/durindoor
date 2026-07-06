# OpenAI Codex Integration

OpenAI Codex and OpenAI-compatible clients can use DurinDoor through OpenAI environment variables or client configuration.

## Prerequisites

- DurinDoor running locally or behind a reachable URL.
- A DurinDoor API key.
- At least one provider or combo suitable for coding tasks.
- Codex CLI or another OpenAI-compatible client.

## Environment Variables

```bash
export OPENAI_BASE_URL="http://localhost:20128/v1"
export OPENAI_API_KEY="YOUR_DURINDOOR_API_KEY"
```

Run Codex with a DurinDoor model or combo:

```bash
codex --model coding-default "Explain the test strategy for this project."
```

Some Codex clients use the Responses API. DurinDoor exposes `/v1/responses` and compatibility rewrites for responses-style requests.

## Model Selection

Use the dashboard or `/v1/models` to choose a model string. Prefer combo names for day-to-day work so provider changes stay inside DurinDoor.

```bash
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

## Configuration File

If your Codex client supports a config file, set the base URL to `http://localhost:20128/v1`, set the API key to a DurinDoor key, and set the model to a DurinDoor model ID, alias, or combo.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Invalid API key | Use a DurinDoor API key, not an upstream provider key. |
| Model not found | Confirm the model is visible in `/v1/models` or create a combo. |
| Responses API error | Verify the client is using `/v1/responses` or the expected compatibility route. |
| Provider-specific failure | Check Usage or Request Details in the dashboard. |
