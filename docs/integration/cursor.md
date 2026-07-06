# Cursor Integration

Cursor can connect to DurinDoor through its OpenAI-compatible custom API settings. Cursor may require a publicly reachable endpoint depending on how your Cursor version routes requests.

## Prerequisites

- Cursor installed.
- A DurinDoor API key.
- A DurinDoor endpoint reachable from Cursor.
- A model ID, alias, or combo configured in DurinDoor.

## Configuration

In Cursor settings, configure the OpenAI-compatible provider:

```text
Base URL: http://localhost:20128/v1
API key:  YOUR_DURINDOOR_API_KEY
Model:    coding-default
```

If Cursor does not accept localhost in your environment, expose DurinDoor through a secure tunnel, VPN, reverse proxy, or remote deployment, then use that public or private network URL.

## Recommended Setup

1. Create a combo named `coding-default`.
2. Add a reliable primary model and at least one fallback.
3. Create a DurinDoor API key for Cursor.
4. Configure Cursor with the combo name.
5. Send a small chat request.
6. Check DurinDoor usage logs to confirm traffic is routed through the expected provider.

## Security Notes

- Do not expose DurinDoor to the public internet with the default password.
- Use HTTPS when Cursor connects over a network.
- Create a dedicated API key for Cursor so it can be revoked independently.
- Limit access with a firewall, tunnel ACL, VPN, or reverse proxy authentication where possible.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Cursor rejects localhost | Use a reachable remote URL or secure tunnel. |
| Invalid API key | Regenerate a DurinDoor key and paste the full value. |
| Model not found | Use a combo name or a model visible in `/v1/models`. |
| Requests do not appear in logs | Cursor may not be using the configured provider or endpoint. |
