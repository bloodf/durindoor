# Provider Connections

Provider connections are the credentials DurinDoor uses to call upstream AI services. A provider can have one connection or many connections. Multiple connections allow account fallback, quota rotation, and separation between personal, team, and project credentials.

## Provider Types

| Type | Examples | Credential shape | Typical use |
| --- | --- | --- | --- |
| OAuth provider | Claude, Codex, Gemini CLI, GitHub, Qwen, iFlow, Kiro, Cursor, Antigravity | Access token plus refresh metadata | Subscription or account-backed providers that require browser login. |
| API key provider | OpenAI, Anthropic, OpenRouter, Mistral, Groq, Together, DeepSeek, GLM, MiniMax, Cohere | Secret key, token, or provider-specific fields | Standard paid or free API services. |
| Web cookie provider | Browser-session services | Session cookie or browser token | Providers that do not expose a normal API key flow. |
| No-auth provider | Local endpoints and selected local tools | No shared secret | Local services that are already protected by host access. |
| Media provider | TTS, STT, embeddings, image, search, fetch providers | Provider-specific | Non-chat API families. |

The dashboard groups providers by category, but all successful connections become usable by the routing layer when the selected endpoint and model support the request type.

## Add an OAuth Connection

1. Open `Dashboard -> Providers`.
2. Select a provider that supports OAuth.
3. Click `Connect` or the provider-specific action.
4. Complete the browser, device-code, or callback flow.
5. Return to the dashboard and run a connection test if available.

DurinDoor stores refresh metadata so it can renew tokens when the upstream provider supports refresh. Some providers limit refresh token lifetime or revoke sessions when account security changes. Reconnect the provider if refresh fails.

## Add an API Key Connection

1. Open `Dashboard -> Providers`.
2. Select the provider.
3. Choose `Add API Key` or `Add Connection`.
4. Paste the provider credential.
5. Add optional labels, proxy settings, or model restrictions.
6. Save and test.

Use provider labels when you keep multiple accounts for the same provider. Labels make usage logs and fallback behavior easier to audit.

## Web Cookie Providers

Web cookie providers bridge browser-session services that do not expose stable API-key endpoints. Paste only cookies from accounts you own, and expect sessions to expire when the upstream site rotates login state.

### ZenMux Free

`zenmux-free` uses the ZenMux free-tier web gateway at `https://zenmux.ai/api/anthropic/v1/messages`. Add it as a Web Cookie connection and paste the full `Cookie` header from `zenmux.ai`; the cookie string must include `ctoken=...`.

DurinDoor converts OpenAI chat requests to ZenMux's Anthropic-compatible message endpoint and converts the upstream Anthropic SSE stream back to OpenAI chat completions. The provider is exposed under alias `zmf`.

### OmniRoute PR #51 Web-Session Port Status

The following OmniRoute providers are registered in DurinDoor's catalog with aliases, models, service kinds, auth hints, and source-file metadata. Providers whose runtime is still absent remain guarded by the explicit `provider_port_pending` executor so they cannot accidentally fall through to the generic OpenAI-compatible HTTP path.

| Provider | Catalog status | Runtime blocker |
| --- | --- | --- |
| `adapta-web` | Web Cookie LLM provider, alias `adp-web`, Adapta model catalog. | Ported chat executor; keep validation tests covering Clerk credential exchange and OpenAI response conversion. |
| `chatgpt-web` | Web Cookie LLM/image provider, alias `cgpt-web`, ChatGPT model catalog. | Chat session exchange and conversion ported; remaining blocker is automatic ChatGPT Sentinel PoW/Turnstile/TLS-sidecar and image cache parity. |
| `copilot-m365-web` | Web Cookie LLM provider, alias `m365copilot`, BizChat model. | Runtime ported with Chathub WebSocket URL/credential parsing, SignalR frame conversion, and OpenAI stream/non-stream conversion. |
| `copilot-web` | Web Cookie LLM provider, Copilot model catalog. | Runtime ported with Copilot `/c/api/start` session creation, browser access-token extraction, and WebSocket stream conversion. |
| `duckduckgo-web` | No-auth free-tier LLM provider, alias `ddgw`, DuckDuckGo AI model catalog. | Runtime ported with anonymous VQD acquisition and OpenAI SSE/JSON translation. The optional browser-backed session pool and full anti-abuse challenge stack are not included in this JS branch. |
| `huggingchat` | Web Cookie LLM provider, HuggingChat production model catalog. | Runtime ported with `hf-chat` cookie normalization, SvelteKit conversation bootstrap, and JSONL-to-OpenAI response conversion. |
| `muse-spark-web` | Web Cookie LLM provider, alias `ms-web`, Muse Spark models. | Runtime ported with Meta/Muse GraphQL request construction, response parsing, and a bounded continuation cache. |
| `suno` | Cookie-backed music provider with Suno model catalog. | `/v1/music/generations` route added with best-effort cookie-backed POST plumbing. The source branch did not include a complete Suno executor contract, so live payload drift may require follow-up. |
| `t3-web` | Web Cookie LLM provider, alias `t3chat`, T3 model catalog. | Ported chat executor; keep validation tests covering `convex-session-id` parsing and OpenAI response conversion. |
| `udio` | Cookie-backed music provider with Udio model catalog. | `/v1/music/generations` route added with best-effort cookie-backed POST plumbing. The source branch did not include a complete Udio executor contract, so live payload drift may require follow-up. |
| `veoaifree-web` | No-auth video provider, alias `veo-free`, VEO/Seedance catalog. | Runtime ported with WordPress nonce fetch, video/image/TTS intent handling, polling, and `/v1/video/generations` plumbing. |
| `yuanbao-web` | Web Cookie LLM provider, alias `ybw`, Tencent Yuanbao model catalog. | Runtime ported with `hy_user`/`hy_token` cookie parsing, conversation creation, chat SSE conversion, and `reasoning_content` support. |

## Ported Runtime Endpoints

- Chat completions: `adapta-web`, `chatgpt-web`, `copilot-m365-web`, `copilot-web`, `duckduckgo-web`, `huggingchat`, `muse-spark-web`, `t3-web`, and `yuanbao-web` are available through `/v1/chat/completions` with their provider-prefixed model IDs.
- Video generation: `veoaifree-web` is available through `/v1/video/generations`.
- Music generation: `suno` and `udio` are available through `/v1/music/generations` as best-effort cookie-backed provider POSTs.
- Still guarded by `provider_port_pending`: `suno` chat fallback and `udio` chat fallback.

## Connection Health

A connection can be active, unavailable, locked for a model, expired, or missing required fields. DurinDoor may mark a connection unavailable after upstream errors such as authentication failure, quota exhaustion, rate limits, or provider-specific refusal.

| Field | Meaning |
| --- | --- |
| Last error | Most recent upstream error associated with the connection. |
| Lock until | Temporary cooldown timestamp for a provider or model. |
| Refresh status | Whether token refresh succeeded, failed, or needs reconnect. |
| Model lock | A model-specific cooldown when only one model fails. |
| Usage | Tokens, requests, cost estimates, and reset information where supported. |

## Account Fallback

When a provider has multiple active connections, DurinDoor can choose another account if the current one fails. This is separate from combo fallback. Account fallback stays inside the same provider and model; combo fallback moves to another model in the configured chain.

```text
Client asks for openai/gpt-4.1
Connection A returns rate limited
DurinDoor tries Connection B for the same provider and model
If all OpenAI connections fail, combo fallback may try the next model
```

## Credential Safety

- Do not expose the dashboard to the public internet without changing the initial password.
- Set `JWT_SECRET` and `API_KEY_SECRET` for production deployments.
- Treat request logs as sensitive when prompt logging is enabled.
- Use separate provider accounts or keys for different teams when auditability matters.
- Rotate credentials in the provider dashboard first, then update DurinDoor.

## Provider Identifiers

DurinDoor uses provider identifiers internally and in model strings. Examples include `openai`, `anthropic`, `gemini`, `cc`, `cx`, `kiro`, and custom compatible prefixes. The exact list comes from the provider registry in the running version.

Use the dashboard model selector or `/v1/models` response as the source of truth for available identifiers in your instance.
