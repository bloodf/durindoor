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

## MITM Proxy, Root CA, Redirect, or Startup Lock Errors

Symptoms:

- MITM fails with a Root CA generation or read error on first start.
- `MITM server is already starting` from another request in this process.
- `MITM server is already starting (lock contention)` from another process.
- Startup reports that PF is disabled, an iptables rule failed, Windows
  firewall isolation failed, or the authenticated public-port check failed.
- A restart says that a fresh sudo credential or UAC-approved start is needed.
- `MITM_PRIVILEGED_OPERATION_UNCERTAIN` after a sudo/UAC timeout or an
  interrupted redirect installation.
- A live legacy integer `.mitm.pid` is refused after an upgrade.

Fixes:

1. Run DurinDoor as a standard user. The full Node.js proxy is never elevated.
   Only the exact certificate, hosts-file, firewall, or port-redirect mutation is
   delegated to sudo/UAC. An already elevated DurinDoor process is refused
   before it can create a CA, change trust, kill a process, or install a rule.
2. On macOS and Linux the proxy listens on `127.0.0.1:8443`; an owner-scoped
   kernel rule redirects that user's `127.0.0.1:443` traffic and rejects other
   users on both ports. macOS PF must already be enabled by system policy;
   DurinDoor does not call `pfctl -E` because doing so without retaining its
   reference token can leave PF enabled. Linux requires sudo plus iptables with
   the `owner`, `multiport`, and `comment` matches.
3. On Windows the standard-user proxy binds `127.0.0.1:443` directly. Windows
   does not require Administrator rights for that bind. DurinDoor uses a narrow
   UAC operation to install an owner-conditioned outbound firewall rule; it
   never creates a machine-wide `netsh portproxy` mapping.
4. The proxy independently verifies the operating-system owner of every new
   loopback connection before health checks or model routing. A request from a
   different local account is rejected before the proxy can inject the owner's
   DurinDoor API key. If owner discovery or the public-port health probe cannot
   be verified, startup fails closed and retains cleanup metadata.
   Mutating MITM controls additionally require a valid dashboard JWT or the
   machine-bound CLI token; loopback, `Origin`, and same-user ownership are not
   treated as authentication. When dashboard login is disabled, use the CLI or
   enable login before changing MITM state in the browser.
5. The executable startup path creates a missing, invalid, mismatched, or
   expiring Root CA before reading TLS files. A valid pair is reused
   byte-for-byte. On POSIX its directory is `0700`, its key is `0600`, and its
   certificate is `0644`; stored API-key strings are never rewritten or rotated.
   During CA rotation, the prior trust entry remains journaled until the exact
   replacement is verified. Linux also replaces and verifies the exact
   certificate in every discovered Chromium or Firefox NSS database; a failed
   NSS update restores the prior entry and leaves the rotation retryable.
6. Hosts entries and system Root CA trust are operating-system-wide even though
   proxy access is owner-contained. Enabling MITM can therefore disrupt the
   targeted IDE traffic of other logged-in users. Treat this as an
   exclusive-interactive-user feature and do not enable it on a shared host.
7. Sudo passwords are memory-only. DurinDoor clears legacy
   `mitmSudoEncrypted` settings and never writes a replacement secret. A cold
   restart that needs sudo, or any Windows restart that needs UAC, waits for an
   explicit user-approved start. Passwordless-sudo Unix installs may restart
   automatically.
8. Stop removes only exact, tagged hosts entries while the verified proxy is
   still available,
   then stops the process, removes only the current user's exact redirect or
   firewall identity, and finally removes PID metadata. A clean unexpected
   child exit enters the bounded restart policy. If privileged cleanup fails,
   PID/rule ownership metadata remains so a later authenticated stop can retry
   rather than reporting a false success. Explicit stop writes the disabled
   preference first; update and restart handoffs preserve the enabled intent.
9. If the plain `already starting` error appears, let the active request finish
   and retry. For `lock contention`, check whether another DurinDoor process is
   starting or stopping MITM. Coordination uses exclusive listeners on
   `127.0.0.1:20443` (startup) and `127.0.0.1:20444` (Root CA publication); the
   operating system releases them automatically on process exit.
10. The redirect journal is global to the operating-system user, not to
    `DATA_DIR`: `~/.durindoor-mitm-state/redirect.json` on macOS/Linux and
    `%USERPROFILE%\AppData\Local\DurinDoor\mitm-state\redirect.json` on
    Windows. This intentionally permits only one MITM transport across all
    DurinDoor data directories owned by that user.
11. If contention remains after every DurinDoor process exits, check whether an
    unrelated local service owns either coordination port. Preserve
    `DATA_DIR/mitm/.mitm.pid` and any `.rootCA.previous.*.crt` recovery journal,
    capture the MITM logs, and retry through the dashboard. Do not delete PID
    metadata, trust journals, firewall rules, or Root CA files manually.
12. A live integer-only `.mitm.pid` came from the previous privileged-launcher
    design and cannot authenticate which process now owns that PID. Stop MITM
    with the old DurinDoor version before updating. If that is no longer
    possible, close DurinDoor and reboot; the new version will remove the dead
    legacy metadata on its next start. Never raw-kill the recorded PID because
    it may have been reused by an unrelated process.

### Recover an uncertain privileged MITM operation

An `installing` or `uncertain` redirect journal is a quarantine marker. A sudo
or UAC descendant may still be running, so DurinDoor deliberately refuses both
start and inverse cleanup. Do not delete the marker while the machine is still
running.

1. Close every DurinDoor process and reboot. Reboot is the boundary that proves
   the unconfirmed privileged process tree has ended.
2. Inspect and remove only the current user's exact DurinDoor rule:
   - macOS: the PF anchor is `com.apple/durindoor.mitm.<uid>`. Inspect with
     `sudo pfctl -a com.apple/durindoor.mitm.$(id -u) -sn` and `-sr`, then remove
     it with `sudo pfctl -a com.apple/durindoor.mitm.$(id -u) -F all`.
   - Linux: inspect `sudo iptables-save` for the exact comment
     `durindoor-mitm-$(id -u)`. Remove only the matching loopback NAT rule for
     port `443` to `8443` and matching owner-isolation OUTPUT rule. Do not flush
     either table or delete another user's comment.
   - Windows: in an elevated PowerShell, obtain the current SID with
     `[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value`,
     inspect `DurinDoor-MITM-Isolation-<SID>` with `Get-NetFirewallRule`, and
     remove that exact name with `Remove-NetFirewallRule` only if its owner,
     loopback address, port, and action match.
3. Verify the exact anchor/rules are absent. Only then delete the user's
   `redirect.json` path listed in step 10. Preserve `.mitm.pid`, Root CA files,
   and trust-rotation journals; DurinDoor reconciles those separately.
4. Start DurinDoor as a standard user and run an authenticated MITM stop/start.
   If any verification differs from the values above, preserve the journal and
   logs and ask a system administrator to review them.

## Request Logs Are Empty

Possible causes:

- Client is not reaching DurinDoor.
- Request logging detail is disabled.
- The request fails before usage persistence.
- The client is using a different endpoint.

Start with `/api/health`, `/v1/models`, and the client base URL.
