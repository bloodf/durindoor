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

The following OmniRoute providers are registered in DurinDoor's catalog with aliases, models, service kinds, auth hints, and source-file blocker metadata. Providers that have not been ported are intentionally guarded by an explicit `provider_port_pending` executor so these entries cannot accidentally fall through to the generic OpenAI-compatible HTTP path.

Worker Noether ported the chat path for these ChatGPT-style web providers:

| Provider | Runtime status | Scope and limitations |
| --- | --- | --- |
| `adapta-web` | Ported executor. | Uses the pasted Clerk `__client` cookie, exchanges it for a short-lived session JWT, sends Adapta chat requests, and converts streaming or non-streaming text responses to OpenAI chat completions. Image/cache flows are not advertised. |
| `chatgpt-web` | Partial chat executor. | Normalizes ChatGPT session-token cookies, exchanges `/api/auth/session` for a bearer token, builds ChatGPT `/backend-api/f/conversation` chat bodies, and can convert ChatGPT SSE when caller-supplied Sentinel tokens are present in `providerSpecificData.chatgptWebSentinel`. Automatic Sentinel proof-of-work, Turnstile solving, TLS sidecar parity, and image/cache routes are not ported in this JS branch; without Sentinel tokens the executor returns `CHATGPT_WEB_SENTINEL_NOT_PORTED` instead of using the generic pending guard. |
| `t3-web` | Ported executor. | Parses full t3.chat Cookie headers or `convexSessionId` structured input, sends chat requests to `https://t3.chat/api/chat`, and converts JSON, SSE, NDJSON, or TSS-shaped text responses to OpenAI chat completions. Convex/browser endpoint discovery beyond the `/api/chat` path is not ported. |

| Provider | Catalog status | Runtime blocker |
| --- | --- | --- |
| `adapta-web` | Web Cookie LLM provider, alias `adp-web`, Adapta model catalog. | Ported chat executor; keep validation tests covering Clerk credential exchange and OpenAI response conversion. |
| `chatgpt-web` | Web Cookie LLM/image provider, alias `cgpt-web`, ChatGPT model catalog. | Chat session exchange and conversion ported; remaining blocker is automatic ChatGPT Sentinel PoW/Turnstile/TLS-sidecar and image cache parity. |
| `copilot-m365-web` | Web Cookie LLM provider, alias `m365copilot`, BizChat model. | Port Microsoft 365 Chathub WebSocket connection and frame helpers. |
| `copilot-web` | Web Cookie LLM provider, Copilot model catalog. | Port Copilot web-session executor and browser-derived access-token flow. |
| `duckduckgo-web` | No-auth free-tier LLM provider, alias `ddgw`, DuckDuckGo AI model catalog. | Port DuckDuckGo anti-abuse challenge solver, FE-signal generation, and optional browser-backed session pool. |
| `huggingchat` | Web Cookie LLM provider, HuggingChat production model catalog. | Port HuggingChat cookie normalization, JSONL stream helper, and SvelteKit conversation bootstrap. |
| `muse-spark-web` | Web Cookie LLM provider, alias `ms-web`, Muse Spark models. | Port Meta/Muse GraphQL request builder, continuation cache, and response parser. |
| `suno` | Cookie-backed music provider with Suno model catalog. | Add `/v1/audio/music` or `/v1/music/generations` route plumbing plus Suno media executor contract. |
| `t3-web` | Web Cookie LLM provider, alias `t3chat`, T3 model catalog. | Ported chat executor; keep validation tests covering `convex-session-id` parsing and OpenAI response conversion. |
| `udio` | Cookie-backed music provider with Udio model catalog. | Add music-generation route plumbing plus Udio media executor contract. |
| `veoaifree-web` | No-auth video provider, alias `veo-free`, VEO/Seedance catalog. | Add video-generation route plumbing and WordPress AJAX workflow executor. |
| `yuanbao-web` | Web Cookie LLM provider, alias `ybw`, Tencent Yuanbao model catalog. | Port Yuanbao cookie-session SSE executor and validation flow. |

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
