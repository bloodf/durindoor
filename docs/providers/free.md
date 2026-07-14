# Free and Local Providers

DurinDoor can route to providers that do not require a traditional paid API key. Some are local services, some use browser or OAuth accounts, and some are free tiers offered by upstream providers. Availability, rate limits, and terms are controlled by the upstream provider.

## Provider Categories

| Category | Description | Examples |
| --- | --- | --- |
| Local model services | Run on the same machine or local network. | Ollama, local OpenAI-compatible servers, local TTS/STT services. |
| No-auth providers | The upstream endpoint does not require a credential from DurinDoor. | Local-only services or explicitly unauthenticated internal gateways. |
| OAuth free tiers | Account-backed services with free allowance. | Provider-specific OAuth integrations. |
| Browser-cookie providers | Services authenticated by a browser session token. | Web providers supported by the registry. |
| Local device media | Audio or speech providers that run on the host device. | Local TTS and STT integrations. |

## Local Providers

For a local OpenAI-compatible server:

1. Start the upstream service.
2. Confirm it responds locally.
3. Add it in `Dashboard -> Provider Nodes`.
4. Use `http://localhost:<port>/v1` or the service-specific base URL.
5. Add supported model names.
6. Test chat and streaming.

If DurinDoor runs in Docker, `localhost` inside DurinDoor means the container itself. Use a Docker network service name or host gateway address for services running outside the container.

## OAuth Free Tiers

OAuth free tiers usually require an account and can change quota rules without notice. DurinDoor can store tokens and refresh them when the provider allows it, but the provider remains the authority for access and limits.

Best practices:

- Keep at least one non-free fallback for critical workflows.
- Watch usage and reset information in the dashboard.
- Reconnect if the upstream account revokes the token.
- Do not assume unlimited use unless the provider contract says so.

## Browser Cookie Providers

Cookie-backed providers are convenient but fragile. Browser sessions can expire, account security changes can revoke cookies, and upstream web APIs may change without warning.

Use cookie-backed providers for personal or experimental workflows unless your team has reviewed the risk.

## No-Auth Providers

A no-auth provider should only be used when the upstream is protected by the network boundary or runs locally. Do not expose a no-auth upstream to the public internet through DurinDoor without adding an outer access-control layer.

## SenseNova Token Plan

SenseNova routes through the OpenAI-compatible Token Plan endpoint (`https://token.sensenova.cn/v1/chat/completions`). The upstream caps `max_tokens` at 65,536, so DurinDoor clamps requests at that ceiling. Supported chat models are `sensenova-6.7-flash-lite`, `deepseek-v4-flash`, and `glm-5.2`.

## Local Device Media

Some media providers run on the local device or a local service. They can be useful for speech, transcription, and development workflows where data should not leave the host.

Check the media provider pages in the dashboard for endpoint-specific fields such as voice, format, model, sample rate, or local service URL.

## Free Provider Reliability

Free and local providers can be excellent fallback targets, but they should be treated as variable capacity. A robust combo usually orders providers by reliability and task fit, not just price.

```text
1. Primary subscription or paid API model
2. Lower-cost compatible model
3. Local model or free-tier model
```

This keeps important work on predictable capacity while preserving a low-cost escape path.
