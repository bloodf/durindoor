# Cursor sign-in comparison (#2034)

Compared 2026-11-20 against repository HEADs:

- CLIProxyAPI `6faa8d20b2673404cff70a2f2d9537ae0d0e684d` and EasyCLIProxyAPI `e4223d5eefa22a3301ca7e2a28d05897432b07f9`: recursive source trees contain no Cursor-named provider implementation. This observation does not establish that every generic extension or external project lacks Cursor support.
- OmniRoute `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`: `src/lib/oauth/providers/cursor.ts` retains token import; `src/lib/oauth/services/cursorLogin.ts` implements deep-control PKCE sessions and `open-sse/services/tokenRefresh/providers/cursor.ts` implements refresh. `src/lib/providerModels/cursorAvailableModels.ts` discovers models through AvailableModels; `open-sse/executors/cursor.ts` and `open-sse/executors/cursor/` implement native requests.

DurinDoor's `src/app/api/oauth/cursor/import/route.js` stores a user-supplied token and machine ID after local format checks, with no provider validation and no refresh token. Its 24-hour expiry is an estimate, not proof of validity. `auto-import/route.js` is the existing local-store import path. `open-sse/services/cursorModels.js` discovers the account catalog via GetUsableModels, with static fallback at callers. `open-sse/executors/cursor.js` handles native requests; AgentService cannot honor a configured proxy and the executor refuses direct use in that case. Host and proxy validation remain in the existing transport paths.

The upstream PKCE and refresh lifecycle is not implemented here; imported credentials cannot be assumed refreshable. Model and request protocols differ, so equivalence cannot be inferred solely from matching names. The synthetic import test checks storage inputs and absence of outbound calls, while the model wiring and strict proxy tests cover their respective mocked paths. These tests do not establish current live Cursor compatibility.
