# OpenAI Codex Integration

OpenAI Codex and OpenAI-compatible clients can use DurinDoor through OpenAI environment variables or client configuration.

## Account binding compatibility

DurinDoor keeps each Codex OAuth connection bound to its own ChatGPT account. Legacy imports may store the binding as `workspaceId`, `chatgptAccountId`, or `accountId`; all three names remain accepted, with `workspaceId` taking precedence. Values are trimmed, unsafe header values are ignored, and aliases are preserved during refresh, backup, and import instead of rewriting credentials.

OAuth logins are deduplicated only when both records have the same unambiguous account binding. A shared email without an account binding, different bindings on the same email, or conflicting aliases remain separate connections so token pairs cannot overwrite one another. Account identifiers and tokens are never returned by the client-facing provider API.

The local callback listener on port `1455` is released after every CLI OAuth outcome, including timeout, denied consent, malformed callbacks, token exchange errors, and credential-save errors. A failed login can therefore be retried immediately without restarting DurinDoor or manually freeing the port.

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

### Compact Responses

Codex clients may call `/v1/responses/compact` to compact conversation context. DurinDoor identifies that operation from the request path and forwards it to the Codex `/responses/compact` upstream endpoint. The original request body and headers are preserved; no private routing field is added to client JSON.

Compact mode and prompt-cache session affinity are request-scoped. They remain stable if DurinDoor refreshes an OAuth token, retries a temporary Codex overload, or tries another configured base URL, and concurrent compact and regular requests cannot inherit one another's routing state.

Codex can report overload or model-capacity errors inside an HTTP 200 event stream. DurinDoor only acts on complete, explicitly structured SSE error events within a bounded prefix. Normal output, comments, incomplete events, and ordinary data that merely mention an error phrase are replayed unchanged. Capacity errors rotate accounts; transient overloads retry the same account according to the configured 503 policy.

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
| Compact request uses the normal endpoint | Confirm the client calls `/v1/responses/compact`; internal body markers are not required. |
| Provider-specific failure | Check Usage or Request Details in the dashboard. |
