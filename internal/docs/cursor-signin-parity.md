# Cursor sign-in comparison (#2034)

Compared 2026-11-20 against repository HEADs:

- CLIProxyAPI `6faa8d20b2673404cff70a2f2d9537ae0d0e684d` and EasyCLIProxyAPI `e4223d5eefa22a3301ca7e2a28d05897432b07f9`: recursive source trees contain no Cursor-named provider implementation. This observation does not establish that every generic extension or external project lacks Cursor support.
- OmniRoute `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`: `src/lib/oauth/providers/cursor.ts` retains token import; `src/lib/oauth/services/cursorLogin.ts` implements deep-control PKCE sessions and `open-sse/services/tokenRefresh/providers/cursor.ts` implements refresh. `src/lib/providerModels/cursorAvailableModels.ts` discovers models through AvailableModels; `open-sse/executors/cursor.ts` and `open-sse/executors/cursor/` implement native requests.

DurinDoor's `src/app/api/oauth/cursor/import/route.js` stores a user-supplied token and machine ID after local format checks, with no provider validation and no refresh token. Its 24-hour expiry is an estimate, not proof of validity. `auto-import/route.js` is the existing local-store import path. `open-sse/services/cursorModels.js` discovers the account catalog via GetUsableModels, with static fallback at callers. `open-sse/executors/cursor.js` handles native requests; AgentService cannot honor a configured proxy and the executor refuses direct use in that case. Host and proxy validation remain in the existing transport paths.

The upstream PKCE and refresh lifecycle is not implemented here; imported credentials cannot be assumed refreshable. Model and request protocols differ, so equivalence cannot be inferred solely from matching names. The synthetic import test checks storage inputs and absence of outbound calls, while the model wiring and strict proxy tests cover their respective mocked paths. These tests do not establish current live Cursor compatibility.

## Authorization decision (2026-11-20)

At the pinned OmniRoute revision, `cursorLogin.ts` creates a PKCE challenge and UUID, selects `redirectTarget=cli`, and polls Cursor with the UUID and verifier for access and refresh tokens. Its refresh provider posts the refresh token to `auth/exchange_user_api_key`; its proxy argument is unused. These are observations of upstream code, not a grant for another client to use that identity or endpoint. See the [login](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/src/lib/oauth/services/cursorLogin.ts) and [refresh](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/services/tokenRefresh/providers/cursor.ts) sources.

Cursor's public [CLI authentication](https://cursor.com/docs/cli/reference/authentication) and [ACP](https://cursor.com/docs/cli/acp) documentation describes authentication of Cursor's CLI and custom clients communicating with that CLI. Its [Origin API](https://cursor.com/docs/api/origin) describes a separate repository API and app registration. None supplies a third-party client registration, permitted callback or authorization, polling and refresh contract for DurinDoor's Cursor native chat transport. The MCP OAuth callback in Cursor's documentation is for Cursor acting as a client of an external MCP server, not a registration for signing in to Cursor.

Until Cursor provides an applicable contract and a DurinDoor client registration and callback (or explicit authorization for an equivalent public client), do not port the CLI-targeted flow. Keep the existing user-supplied import path; it does not acquire a refresh token. The public documentation examined is current as of the date above and may change. No live provider request was made for this assessment.

## Pinned behavior pass (2026-11-23)

CLIProxyAPI `6eb8554f0ede` has no Cursor-named implementation in its recursive tree. OmniRoute `5ffa68e83544` retains Cursor support. This pass is incomplete; the table records inspected behavior, not a claim of full parity.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Login URL, PKCE and polling | `src/lib/oauth/services/cursorLogin.ts` | Intentionally different: import-only, as described in the authorization decision above; the upstream CLI-targeted flow has not been ported. |
| Token refresh and retry | `open-sse/services/tokenRefresh/providers/cursor.ts` | Not ported; imported tokens have no refresh token. |
| Account identity | `src/lib/oauth/services/cursorLogin.ts` | Partially matched: JWT identity is extracted for imports; login credential construction remains unimplemented. |
| Connect error classification | `open-sse/executors/cursor/cursorErrors.ts` | Ported here for JSON error frames: distinguish oversized requests, quota, model entitlement, missing models and authentication. Other upstream error paths remain to compare. |
| Request envelope, headers, retries, quotas, model catalog, streaming and remaining error branches | `open-sse/executors/cursor.ts`, `open-sse/executors/cursor/`, model and usage services | Comparison incomplete; no parity claim. Identity cloaking and detection evasion are out of scope. |
