# Continue Integration

Continue can connect to DurinDoor using an OpenAI-compatible model configuration.

## Prerequisites

- VS Code or a supported Continue environment.
- DurinDoor endpoint and API key.
- A model or combo configured in DurinDoor.

## Configuration Example

Open the Continue configuration and add a model entry:

```json
{
  "models": [
    {
      "title": "DurinDoor Coding Default",
      "provider": "openai",
      "model": "coding-default",
      "apiKey": "YOUR_DURINDOOR_API_KEY",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

For a remote DurinDoor deployment, replace `apiBase` with the HTTPS URL for that deployment.

## Multiple Models

You can add several DurinDoor combos and choose between them in Continue:

```json
{
  "models": [
    {
      "title": "DurinDoor Fast",
      "provider": "openai",
      "model": "coding-fast",
      "apiKey": "YOUR_DURINDOOR_API_KEY",
      "apiBase": "http://localhost:20128/v1"
    },
    {
      "title": "DurinDoor Best",
      "provider": "openai",
      "model": "coding-best",
      "apiKey": "YOUR_DURINDOOR_API_KEY",
      "apiBase": "http://localhost:20128/v1"
    }
  ]
}
```

## Verification

After reloading Continue, send a small prompt and check DurinDoor usage logs. If Continue sends large context or tool requests, test the exact workflow before relying on a new combo.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Continue cannot reach DurinDoor | Check `apiBase`, firewall, and whether DurinDoor is running. |
| Invalid model | Use a combo name or a model visible in `/v1/models`. |
| Provider parameter error | The selected upstream may not support a parameter Continue sends. Try another model or provider node. |
