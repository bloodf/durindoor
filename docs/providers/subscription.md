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

Some registry providers are marked hidden because the generic connection form does not collect enough provider-specific data for them yet. Hidden providers do not appear in the legacy `Dashboard -> Providers -> Add New Provider` selector and the legacy `/api/providers` creation route rejects direct connection attempts for them. Existing visible providers and custom compatible provider nodes continue to use the same connection flow.

Dedicated local and router provider IDs such as `lm-studio`, `vllm`, `llama-cpp`, `docker-model-runner`, and `9router` are documented in [Local, Self-Hosted, and Router Providers](./local-router-providers.md). These providers use OpenAI-compatible local defaults and can override the base URL per saved connection.
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

Provider validation and connection tests have bounded deadlines. Validation
probes stop after 10 seconds, while API-key and OAuth connection tests stop
after 15 seconds, rather than leaving the dashboard waiting indefinitely when
an upstream accepts a connection but never responds. Custom provider URLs
remain subject to the outbound SSRF guard.

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

DurinDoor uses provider identifiers internally and in model strings. Examples include `openai`, `anthropic`, `gemini`, `cc`, `kiro`, and custom compatible prefixes. The exact list comes from the provider registry in the running version.

### Provider Catalogs

Registry-backed providers can load account-specific catalogs at runtime. Qoder uses its authenticated COSY model list and keeps a static fallback containing current `lite`, `qmodel_38max` (Qwen3.8-Max), and `gmodel` (GLM-5.3) identifiers; vision-capable Qoder models accept OpenAI URL/data-URI images and Claude base64 image blocks. Registry-backed OpenAI-compatible nodes such as `hcnsec` keep their live upstream catalog.

BigModel (`bigmodel`) uses its standard OpenAI-compatible chat endpoint with a static `glm-5.3` (text-only) and `glm-5.3-flash` (vision) catalog. Both models advertise a vendor-labelled 1M-token context window (the catalog value 1000000; BigModel does not publish the exact integer) and BigModel's published `max_tokens.maximum` of 131072. Reasoning is always on for both models via the `low`/`high`/`max` `reasoning_effort` enum and cannot be disabled. It does not use the separate GLM Coding Plan endpoint and does not perform live model discovery.

For custom OpenAI-compatible and Anthropic-compatible nodes, the operator's saved **Available Models** rows and compatible aliases are the authoritative public list. An empty saved list exposes no models for that node; use the dashboard's **Import** action to discover upstream models before saving them. Clients should treat DurinDoor's `GET /v1/models` response as the source of truth.

When the add-key dialog creates default connection names, it chooses the first unused name in the `main`, `main-2`, `main-3`, ... sequence. Reopening the dialog after a successful add clears prior secrets and provider-specific fields; background refreshes while the dialog is open preserve in-progress input.

### Current 1M model catalog corrections

- Claude Code exposes `claude-opus-5`; the dashboard's default Opus mapping points to `cc/claude-opus-5`.
- Anthropic Opus 5, Sonnet 5, Fable 5.1, Fable 5, Opus 4.8, Opus 4.7, Opus 4.6, and Sonnet 4.6 use a native 1M context window and do not require a beta header.
- Direct OpenAI GPT-5.6 (`gpt-5.6`, Sol, Terra, Luna) and GPT-5.5 resolve with a 1.05M context window and 128k max output.
- Kiro GPT-5.6 Sol/Terra/Luna use the same approved 1.05M catalog context in DurinDoor while keeping Kiro's existing 32k output capability.
- OpenCode Go and CommandCode expose `deepseek-v4-flash-vision-exp` as a 1M-context vision model. CommandCode also accepts `deepseek/deepseek-v4-flash-vision-exp`; its OpenAI request translator preserves remote image URLs and data URIs as native image blocks.
- Direct OpenAI `gpt-6-astra` resolves with a 1.05M context window, max input 922,000, and 128k max output. The OpenAI API documents `temperature`, `top_p`, `top_logprobs`, and Chat `logprobs` as unsupported on Astra; Responses requests also remove `include: ["message.output_text.logprobs"]` while preserving unrelated include entries. Reasoning effort accepts `low/medium/high/xhigh/max` on the API and adds `ultra` on the ChatGPT Codex surface; Astra cannot disable reasoning, so client `none` and the unsupported `minimal` value are rewritten to the published `low` floor on the wire.
- The ChatGPT Codex OAuth surface serves `gpt-6-astra` at its own 272k context window with no published output ceiling. Its pinned catalog also lists an optional 872k maximum context window; this is not the default advertised limit. Astra is now a built-in default model for both `openai` and `codex` connections, while existing saved `connection.defaultModel` values are preserved unchanged. When no client effort is supplied, Codex's existing executor fallback sends effective `low`. Source: [OpenAI model docs](https://developers.openai.com/api/docs/models/gpt-6-astra), [pinned openai/codex `codex-rs/models-manager/models.json`](https://github.com/openai/codex/blob/3921a30d6b11218883e5bb81a48082095cf79b7c/codex-rs/models-manager/models.json).
- The running `/v1/models` response remains the source of truth for configured connections.

## OmniRoute OAuth Provider Slice

DurinDoor ports OAuth/session providers only when the runtime transport, credential serialization, and token refresh behavior are covered by local tests.

Implemented in this slice:

| Provider | Identifier | Credential path | Refresh behavior |
| --- | --- | --- | --- |
| Antigravity CLI | `agy` | Same Google OAuth shape as Antigravity, stored under a separate provider id so CLI credentials do not collide with IDE credentials. | Reuses the Antigravity Google refresh flow. |
| Grok Build CLI | `grok-cli` | Complete the existing device-code flow, import one `~/.grok/auth.json` object, or use **Bulk Add** for an array/`accounts` object. Bulk import accepts snake_case or camelCase token keys, derives identity/expiry, and reports each item without returning tokens. A successful sparse credits response with object-valued `config` and omitted or `null` `creditUsagePercent` renders a 0% `Credits` quota before first use. Missing or malformed (`null`/array) config still falls through to gRPC/no-allotment; explicit aggregate, product, on-demand, and prepaid rows remain authoritative. | Uses the xAI OAuth token endpoint and stores rotated refresh tokens when returned. Imports stay serial so connection priorities retain input order. |
| GitLab Duo | `gitlab-duo` | Browser OAuth with PKCE against `GITLAB_DUO_BASE_URL`/`GITLAB_BASE_URL`, or per-connection `baseUrl` metadata. Chat messages are adapted to GitLab Code Suggestions completions. | Refreshes through the instance `/oauth/token` endpoint and keeps base URL/client metadata with the connection. |
| Trae | `trae` | Import a Trae SOLO `Cloud-IDE-JWT` token. Optional identity metadata (`webId`, `bizUserId`, `userUniqueId`, tenant/scope/region) is carried in provider-specific data. | Pasted Cloud-IDE-JWT tokens do not expose a public refresh flow; reconnect by importing a new token when Trae expires it. |
| Devin CLI | `devin-cli` | Import a Devin/Windsurf token or rely on `devin auth login` credentials. Runtime calls spawn `devin acp --agent-type summarizer` over ACP stdio; set `CLI_DEVIN_BIN` to override binary discovery. | No public token refresh is available for imported tokens; reconnect or re-authenticate the official CLI when the upstream session expires. |
| Windsurf | `windsurf` | Import the Windsurf/Codeium token shown by the IDE command-palette auth-token flow. Runtime calls use Windsurf's `LanguageServerService/GetChatMessage` gRPC-web endpoint with a direct protobuf request encoder and OpenAI-compatible SSE chunk output. | No public refresh flow is available for imported tokens; reconnect by importing a fresh token if Windsurf rejects the session. |

Windsurf runtime details:

1. The executor maps DurinDoor/OmniRoute model aliases to Windsurf wire identifiers before encoding the request.
2. The request body is a dependency-free protobuf encoder wrapped in a gRPC-web data frame; the API token is sent both as a bearer header and in protobuf metadata.
3. The response parser accepts gRPC-web data frames and trailer frames, decodes content, done/usage, and error chunks, and emits OpenAI-compatible SSE chunks.
4. Wire-level unit tests cover malformed/truncated frames and upstream error chunks so the runtime is no longer guarded as `501`.

Use the dashboard model selector or `/v1/models` response as the source of truth for available identifiers in your instance.
