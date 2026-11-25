# Cursor sign-in comparison (#2034)

Initial comparison on 2026-11-20:

- CLIProxyAPI `6faa8d20b2673404cff70a2f2d9537ae0d0e684d` and EasyCLIProxyAPI `e4223d5eefa22a3301ca7e2a28d05897432b07f9`: recursive source trees contain no Cursor-named provider implementation. This observation does not establish that every generic extension or external project lacks Cursor support.
- OmniRoute `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`: `src/lib/oauth/providers/cursor.ts` retains token import; `src/lib/oauth/services/cursorLogin.ts` implements deep-control PKCE sessions and `open-sse/services/tokenRefresh/providers/cursor.ts` implements refresh. `src/lib/providerModels/cursorAvailableModels.ts` discovers models through AvailableModels; `open-sse/executors/cursor.ts` and `open-sse/executors/cursor/` implement native requests.

DurinDoor's `src/app/api/oauth/cursor/import/route.js` stores a user-supplied token and machine ID after local format checks, with no provider validation and no refresh token. Its 24-hour expiry is an estimate, not proof of validity. `auto-import/route.js` is the existing local-store import path. `open-sse/services/cursorModels.js` discovers the account catalog via GetUsableModels, with static fallback at callers. `open-sse/executors/cursor.js` handles native requests; AgentService uses the selected HTTP/2 proxy route and rejects unsupported routes. Host and proxy validation remain in the existing transport paths.

The deep-control PKCE and refresh lifecycle is now implemented; imported credentials do not acquire a refresh token. Model and request protocols differ, so equivalence cannot be inferred solely from matching names. The synthetic import test checks storage inputs and absence of outbound calls, while the model wiring and strict proxy tests cover their respective mocked paths. These tests do not establish current live Cursor compatibility.

## Authorization decision (2026-11-20)

At the pinned OmniRoute revision, `cursorLogin.ts` creates a PKCE challenge and UUID, selects `redirectTarget=cli`, and polls Cursor with the UUID and verifier for access and refresh tokens. Its refresh provider posts the refresh token to `auth/exchange_user_api_key`; its proxy argument is unused. These are observations of upstream code, not a grant for another client to use that identity or endpoint. See the [login](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/src/lib/oauth/services/cursorLogin.ts) and [refresh](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/services/tokenRefresh/providers/cursor.ts) sources.

Cursor's public [CLI authentication](https://cursor.com/docs/cli/reference/authentication) and [ACP](https://cursor.com/docs/cli/acp) documentation describes authentication of Cursor's CLI and custom clients communicating with that CLI. Its [Origin API](https://cursor.com/docs/api/origin) describes a separate repository API and app registration. None supplies a third-party client registration, permitted callback or authorization, polling and refresh contract for DurinDoor's Cursor native chat transport. The MCP OAuth callback in Cursor's documentation is for Cursor acting as a client of an external MCP server, not a registration for signing in to Cursor.

The 2026-11-23 work order authorized implementing the CLI-targeted flow in DurinDoor. The assessment found no public third-party registration contract. The user-supplied import path remains available and does not acquire a refresh token. The public documentation examined is current as of the date above and may change. No live provider request was made for this assessment.

## Pinned behavior pass (2026-11-23)

CLIProxyAPI `6eb8554f0ede` has no Cursor-named implementation in its recursive tree. OmniRoute `5ffa68e83544` retains Cursor support. The table records the implementation and remaining differences at the pinned revision. No live provider request was used for this comparison.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Login URL, PKCE and polling | `src/lib/oauth/services/cursorLogin.ts` | Deep-control PKCE login routes provide a server-held 15-minute verifier, pending polling, cancellation and one-time consumption; the dashboard retains its import-only interface. Sessions are process-local and require sticky routing on multiple replicas. |
| Token refresh and retry | `open-sse/services/tokenRefresh/providers/cursor.ts` | Exchanges refresh credentials with three bounded attempts and transient backoff. DurinDoor honors the connection proxy rather than ignoring it. Imported tokens remain unrefreshable. |
| Account identity | `src/lib/oauth/services/cursorLogin.ts` | JWT subject, email and skewed expiry are extracted; an existing OAuth connection is matched by account ID, and new connections are created without overwriting an unrelated account. |
| Request envelope | `open-sse/executors/cursor.ts`, `open-sse/utils/cursorAgentProtobuf.ts` | Both send AgentService Run frames, model selection, history and tool definitions; DurinDoor omits an empty tool envelope. DurinDoor keeps its existing protobuf implementation and maps output constraints and tool choice into the prompt; upstream has additional session reuse and built-in tool bridging. |
| Headers and transport | `open-sse/executors/cursor.ts`, `open-sse/executors/cursor/h2AgentStream.ts` | Both use HTTP/2 and Cursor headers; DurinDoor uses its own checksum and proxy transport and enforces its configured egress policy. |
| Retries | `open-sse/executors/cursor.ts`, `open-sse/executors/cursor/streamDriver.ts` | DurinDoor retries one empty long-history turn with a reduced history, before output; a final empty turn retains its existing HTTP 400 response. Upstream has additional session and transport recovery behavior. |
| Quotas and usage | `open-sse/services/usage/cursor.ts` | Dashboard and auth usage, summary fallback and aggregated per-model billed usage are supported. DurinDoor retains its quota presentation and has a separate cookie-based quota provider; fallback order and presentation differ. |
| Model catalog | `src/lib/providerModels/cursorAvailableModels.ts` | DurinDoor prefers GetUsableModels, falling back to AvailableModels JSON with disabled-model filtering, context and effort metadata, and an auto entry. Upstream uses AvailableModels directly and includes additional catalog-specific variants. |
| Streaming and errors | `open-sse/executors/cursor/cursorErrors.ts`, `errorProjection.ts`, `streamDriver.ts` | Connect JSON and end-stream error trailers are classified and sanitized for buffered and SSE responses; typed protobuf error details are projected with bounded parsing; The retained StreamUnifiedChatWithTools path returns the sanitized provider message without a category prefix. AgentService emits an SSE error and no success finish after a mid-stream reset. OmniRoute classifies AgentService errors with category prefixes and reports certain partial timeouts as truncated completions. |

These comparisons do not establish live Cursor compatibility. Identity cloaking and detection evasion remain out of scope.

## Remaining differences

- The dashboard offers import. The deep-control start, poll and cancel routes can be called directly, and server-side refresh runs through the shared credential lifecycle. OmniRoute additionally offers dashboard sign-in and a dedicated refresh route.
- DurinDoor creates a new AgentService stream for each request and retries only long-history empty turns. OmniRoute can resume streams for deferred built-in tool results, reuse its session state, and rotate stale sessions.
- DurinDoor retains its existing client headers, quota presentation and static catalog. OmniRoute uses different AgentService headers, quota hints to classify empty turns, and catalog-specific model variants.

### Request isolation and response limits

AgentService uses a new server-generated conversation ID for each gateway request. The gateway ignores client-supplied conversation IDs and replays the supplied message history. An empty-turn retry uses the same generated ID with the trimmed history. A stop list with no nonempty strings produces no stop directive.

The JSON AvailableModels fallback uses the configured Cursor API endpoint. Both catalog transports honor the connection's ghost-mode setting, and the cache separates settings and endpoints. Catalog and usage bodies are limited to 1 MiB, and login and refresh bodies to 64 KiB. Oversized catalog and usage responses follow the existing fallback paths. Login and refresh record the JWT's actual expiry so the shared refresh policy can apply its lead time once, including for short-lived access tokens.
