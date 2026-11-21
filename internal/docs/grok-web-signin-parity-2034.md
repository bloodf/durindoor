# Grok Web comparison (#2034)

Compared offline using fake credentials. The upstream snapshots are CLIProxyAPI
[`6faa8d20`](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d), EasyCLIProxyAPI
[`e4223d5e`](https://github.com/router-for-me/EasyCLIProxyAPI/tree/e4223d5eefa22a3301ca7e2a28d05897432b07f9), and OmniRoute
[`e3c1531a`](https://github.com/cheaper-inference/OmniRoute/tree/e3c1531afd07d5e06f7ffab658584a7ae2e3627e).

- CLIProxyAPI's [xAI auth types](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth/xai/types.go) and [xAI executor](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor/xai_executor.go) describe xAI OAuth/API requests, not a Grok Web SSO implementation. No Grok Web provider was found in the inspected core tree.
- EasyCLIProxyAPI's [guided provider selector](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src/pages/EasyModePage.tsx) offers xAI OAuth and API-key setup; runtime is delegated to its separately versioned core. No dedicated Grok Web sign-in was found in that selector; this does not prove that every possible core or plugin lacks it.
- OmniRoute's [web-session credential definition](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/src/shared/providers/webSessionCredentials.ts), [cookie builder](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/src/lib/providers/webCookieAuth.ts), and [executor](https://github.com/cheaper-inference/OmniRoute/blob/e3c1531afd07d5e06f7ffab658584a7ae2e3627e/open-sse/executors/grok-web.ts) define a separate cookie-backed Grok Web path. Its streaming executor emits a final message if no visible tokens were sent. DurinDoor now preserves that case, based on that executor; it avoids duplicating a final message after token chunks. Both paths report 401/403 as possible expired sessions and retain 429 as rate limiting.

DurinDoor's web-login session is separate from its xAI OAuth and Grok CLI device flow. It captures `sso`; OmniRoute also accepts `sso-rw` in a manually supplied cookie. Paired-cookie compatibility, upstream tool handling, and other transport differences are not established as parity by these tests. No live sign-in, provider traffic, or browser validation was performed. The local tests exercise synthetic session expiry, per-request cookie isolation, HTTP errors, and final-only/token streaming; they do not establish real account acceptance or full gateway integration.

Grok Web validates `modelResponse.message` before building either response format. A non-null, non-string value uses the existing upstream error path. Streaming emits an error chunk followed by the stop chunk and `[DONE]`. Non-streaming returns HTTP 502 with `GROK_ERROR`. Offline mocks cover malformed objects and valid final-only strings in both modes.

## Saved-cookie lifecycle (#2034)

Offline lifecycle evidence is `tests/unit/provider-cookie-lifecycle-chatgpt-grok.test.js` (real database, routes, `handleChat`, account fallback and the grok-web executor; synthetic credentials; fetch mocked closed). The pins above are the 2026-11-20 snapshot and were reused, not re-fetched. No grok.com request, real session or browser was used.

Verified: create (bare, `sso=`, padded, base64-padding and full-header pastes), Validate and Test Connection skipped without any outbound request, `/v1/models` discovery, JSON and SSE through Chat Completions, Messages and Responses, per-account cookie isolation, 401 fallback to a sibling, 401 with an actionable message when no sibling exists, and recovery after re-paste.

The empty-session rule is covered offline by `tests/unit/grok-web-empty-sso.test.js`: missing, blank and empty `sso` entries are rejected with 401 and no outbound fetch, while a bare value, a padded raw token, a padded `sso` value and a full signed header are still accepted. Synthetic credentials and a closed fetch mock only; no grok.com request, real session or browser was used.

Gaps found and fixed (DurinDoor-original; the OmniRoute `grok-web.ts` pin remains the only parity reference and no code was copied from it):

- Registry `transport.format` was `grok-web`, which routed chat streams through the translate path and dropped the upstream `[DONE]` sentinel. It is now `openai` with `executor: "grok-web"`; dispatch still goes to the grok-web executor by id. `AGENT-INDEX.md` was regenerated.
- A full DevTools Cookie header that did not start with `sso` was sent as `sso=<whole header>`. `buildGrokCookieHeader` now forwards a pasted header as is when it contains `sso=`, trims whitespace and a `Cookie:` prefix, and rejects a header without `sso` locally with 401 before any request.
- An explicitly empty `sso=` was read as a raw token and sent as the header `sso=sso=`. `buildGrokCookieHeader` now rejects an `sso` entry whose value is empty or blank, the same way as a missing `sso`: locally, with 401, and no request to grok.com. A raw token that only ends in `=` padding, such as `tok==`, is still accepted and forwarded unchanged, and a full signed header is still sent as pasted.
- The Edit dialog's re-pasted cookie was dropped by the PUT route (see the ChatGPT Web note); fixed in the shared route.
- The usage route returned "not available" for cookie connections, so `getGrokWebUsage` was unreachable. Saved Grok Web connections now report local 30-day history.

Known limits: no cookie rotation write-back, no remote quota, `sso-rw` is only forwarded from a pasted header, and Validate stays skipped because the only chat endpoint creates a conversation.
