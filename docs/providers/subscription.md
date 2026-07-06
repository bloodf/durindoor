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
| Antigravity CLI | `agy` | Same Google OAuth shape as Antigravity, stored under a separate provider id so CLI credentials do not collide with IDE credentials. | Reuses the Antigravity Google refresh flow. |
| Grok Build CLI | `grok-cli` | Import `~/.grok/auth.json` or a raw Grok JWT through the import-token flow. Auth JSON imports preserve the refresh token and non-secret account metadata. | Uses the xAI OAuth token endpoint and stores rotated refresh tokens when returned. |
| GitLab Duo | `gitlab-duo` | Browser OAuth with PKCE against `GITLAB_DUO_BASE_URL`/`GITLAB_BASE_URL`, or per-connection `baseUrl` metadata. Chat messages are adapted to GitLab Code Suggestions completions. | Refreshes through the instance `/oauth/token` endpoint and keeps base URL/client metadata with the connection. |
| Trae | `trae` | Import a Trae SOLO `Cloud-IDE-JWT` token. Optional identity metadata (`webId`, `bizUserId`, `userUniqueId`, tenant/scope/region) is carried in provider-specific data. | Pasted Cloud-IDE-JWT tokens do not expose a public refresh flow; reconnect by importing a new token when Trae expires it. |
| Devin CLI | `devin-cli` | Import a Devin/Windsurf token or rely on `devin auth login` credentials. Runtime calls spawn `devin acp --agent-type summarizer` over ACP stdio; set `CLI_DEVIN_BIN` to override binary discovery. | No public token refresh is available for imported tokens; reconnect or re-authenticate the official CLI when the upstream session expires. |

Blocked from runtime exposure in this slice:

| Provider | Reason |
| --- | --- |
| `windsurf` | Requires the Windsurf gRPC-web protobuf encoder/decoder for `LanguageServerService/GetChatMessage`, model alias normalization, and stream framing tests. The registry exposes import-token metadata, but runtime calls stay blocked until the wire encoder is ported and verified. |

Windsurf implementation plan:

1. Port the OmniRoute `open-sse/executors/windsurf.ts` protobuf helpers to plain JS: gRPC-web frame writer/reader, `GetChatMessage` request encoding, response chunk decoding, and model alias normalization.
2. Add unit tests for model alias mapping, OpenAI message conversion, gRPC-web frame parsing, content/done/error chunk decoding, and the guarded executor path.
3. Replace the current `501` guard with the real executor only after the tests cover malformed/truncated frames and upstream error chunks.
4. No new package dependency is expected if the minimal encoder is ported directly; using generated protobufs would require adding a protobuf runtime and generated code, so the direct encoder remains the preferred small port.

Use the dashboard model selector or `/v1/models` response as the source of truth for available identifiers in your instance.
