# Troubleshooting

Use this guide to isolate common DurinDoor failures. Start with the local gateway, then check client configuration, then provider configuration.

## Quick Checks

```bash
curl http://localhost:20128/api/health
curl http://localhost:20128/v1/models \
  -H "Authorization: Bearer YOUR_DURINDOOR_API_KEY"
```

If the health check fails, DurinDoor is not reachable. If the model list fails, check API key and dashboard state.

## Connection Refused

Symptoms:

- `ECONNREFUSED`
- Browser cannot open the dashboard.
- Client says it cannot reach the base URL.

Checks:

1. Confirm DurinDoor is running.
2. Confirm the port is correct.
3. Confirm the client includes `/v1` for API requests.
4. Check firewall or container networking.
5. If Docker is used, confirm the port is published.

## Invalid API Key

Symptoms:

- `401 Unauthorized`
- `Invalid API key`
- Client authentication failure.

Fixes:

1. Use a DurinDoor API key, not an upstream provider key.
2. Copy the whole key from the dashboard.
3. Regenerate the key if it was rotated or deleted.
4. Confirm `API_KEY_SECRET` did not change between deployments when using generated CRC keys.

## Model Not Found

Symptoms:

- `model not found`
- Provider route cannot resolve the model.
- Client works with one model but not another.

Fixes:

1. Call `/v1/models` and copy the exact model ID.
2. Use a combo name for stable client configuration.
3. Confirm the provider connection is active.
4. Confirm a compatible provider node still has that model configured.
5. Check whether the model is valid for the endpoint type.

## Provider Authentication Failure

Symptoms:

- Upstream `401` or `403`.
- OAuth provider needs reconnect.
- Cookie-backed provider stops working.

Fixes:

1. Open the provider in the dashboard.
2. Reconnect OAuth providers.
3. Rotate or replace API keys.
4. Refresh browser cookies where applicable.
5. Check whether the upstream account revoked access.

## Rate Limits or Quota Exhaustion

Symptoms:

- `429 Too Many Requests`.
- Requests fall back unexpectedly.
- A provider or model is temporarily locked.

Fixes:

1. Check Usage and Provider Limits.
2. Inspect the request log for the first failing provider.
3. Wait for the upstream reset window.
4. Add another connection for the same provider if appropriate.
5. Add a combo fallback for important workflows.

Round-robin combos advance from the model that actually served the request. If the scheduled first model fails and the second model serves, the next request starts after that served model instead of reusing it.

## Streaming Problems

Symptoms:

- Client hangs.
- Response starts but never finishes.
- Reverse proxy closes long requests.

Fixes:

1. Increase reverse proxy read and send timeouts.
2. Test without the proxy on localhost.
3. Try non-streaming mode if the client supports it.
4. Check whether the selected provider supports streaming for that endpoint.
5. Inspect server logs for upstream stream parse errors.

## Tool Call Problems

Symptoms:

- Coding agents fail after selecting tools.
- Tool results disappear or appear malformed.
- Fallback model works for chat but not for agent workflows.
- Native Gemini `/v1beta` clients receive plain text but miss function calls.

Fixes:

1. Test each model in the combo directly.
2. Confirm the upstream supports tool calls.
3. Avoid fallback models that only support plain chat.
4. Check translator-related errors in request details.
5. Prefer direct provider routes for fragile formats when available.
6. For Gemini SDK clients, use the `/v1beta/models/{model}:generateContent` or `:streamGenerateContent` route so DurinDoor preserves `functionCall` and `functionResponse` parts through the OpenAI bridge.

## Web Fetch Provider Problems

Symptoms:

- `/v1/web/fetch` says a provider is unsupported.
- TinyFish returns empty content or an upstream error.

Fixes:

1. Confirm the provider model is `tinyfish` when using TinyFish Fetch.
2. Configure the TinyFish API key from `agent.tinyfish.ai/api-keys`; DurinDoor sends it as `X-API-Key`.
3. Use `markdown` or `html`; TinyFish does not provide links or screenshots, so unsupported output formats are fetched as markdown.

## Strict Provider Parameter Rejections

Symptoms:

- Upstream `400` mentions `context_management`, `client_metadata`, `thinking`, or `reasoning`.
- Claude Code, Codex, OpenCode, or Gemini clients work with one provider but fail with a strict OpenAI-compatible gateway.

Fixes:

1. Retry with the same provider after DurinDoor strips known incompatible passthrough fields.
2. If the error is from Antigravity or Gemini Code Assist and mentions a disabled project or API, fix the Google Cloud project/API permission; DurinDoor treats that `403` as recoverable and does not persist a connection cooldown.
3. Prefer provider-native models when a gateway rejects reasoning or metadata fields that the original provider accepts.

## Docker Networking Problems

Symptoms:

- DurinDoor in Docker cannot reach a local model server.
- `localhost` works on the host but not in the container.

Fixes:

- Use a Docker network service name for another container.
- Use `host.docker.internal` on macOS and Windows.
- On Linux, add a host gateway mapping if needed.
- Confirm the upstream service binds to an address reachable from the container.

## Dashboard Login Problems

Fixes:

1. Confirm the correct `INITIAL_PASSWORD` or current password.
2. Use the CLI settings menu if available to reset local dashboard auth.
3. Confirm cookies are accepted by the browser.
4. If using OIDC, confirm callback URLs and provider configuration.
5. Check `JWT_SECRET` consistency across restarts.

## MITM Root CA Not Found or Server Already Starting

Symptoms:

- MITM fails immediately with `Root CA not found` or exits on first run.
- `MITM server is already starting (lock contention)` error.

Fixes:

1. The MITM server now auto-generates the Root CA on first start if `rootCA.key`/`rootCA.crt` are missing or expired.
2. A missing certificate no longer requires manual generation before starting.
3. The startup path removes stale lock files when the owning process is gone.
4. If two MITM starts run at the same time, wait for the first to finish instead of starting a second instance.

## Request Logs Are Empty

Possible causes:

- Client is not reaching DurinDoor.
- Request logging detail is disabled.
- The request fails before usage persistence.
- The client is using a different endpoint.

Start with `/api/health`, `/v1/models`, and the client base URL.
