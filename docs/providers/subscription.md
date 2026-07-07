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

## OmniRoute OAuth Provider Slice

DurinDoor ports OAuth/session providers only when the runtime transport, credential serialization, and token refresh behavior are covered by local tests.

Implemented in this slice:

| Provider | Identifier | Credential path | Refresh behavior |
| --- | --- | --- | --- |
| Antigravity CLI | `agy` | Same Google OAuth shape as Antigravity, stored under a separate provider id so CLI credentials do not collide with IDE credentials. OAuth authorization, proactive refresh, and image generation adapter lookup are all explicitly registered for `agy` before it is shown in the dashboard. | Reuses the Antigravity Google refresh flow. |
| Grok Build CLI | `gb` / `grok-cli` | Import `~/.grok/auth.json`, a raw Grok JWT, or a structured `{ accessToken, refreshToken }` body through the dashboard import-token flow. The dashboard Add action opens the import dialog instead of the generic browser OAuth modal because Grok CLI credentials are captured outside DurinDoor. Auth JSON imports persist the refresh token and decoded non-secret account metadata only; raw auth JSON is never stored in public provider metadata. The short alias is `gb` so Gemini CLI keeps the existing `gc` shorthand. | Uses the xAI OAuth token endpoint and stores rotated refresh tokens when returned. |

Blocked from runtime exposure in this slice:

| Provider | Reason |
| --- | --- |
| `devin-cli` | Requires the official Devin CLI ACP stdio executor plus binary discovery and process lifecycle tests. DurinDoor has no matching executor subsystem in this branch. |
| `gitlab-duo` | Requires GitLab Duo executor request/response adaptation, dynamic base URL OAuth endpoints, and token exchange tests for instance-specific client credentials. |
| `trae` | Requires the Trae SOLO session executor, `/authorize` callback/import route, Cloud-IDE-JWT identity propagation, and MITM/session handling that is not present in this branch. |
| `windsurf` | Requires the Windsurf gRPC-web executor and import-token UI/API flow for IDE-generated Codeium tokens. The runtime wire encoder is not present in this branch. |

Use the dashboard model selector or `/v1/models` response as the source of truth for available identifiers in your instance.
