# Yuanbao Web session compatibility (#2034)

Tencent Yuanbao Web (`yuanbao-web`, alias `ybw`) uses a user-supplied Yuanbao
web session containing both `hy_user` and `hy_token`; it is not OAuth. Paste the
cookie into the Yuanbao Web connection, not Tencent Hunyuan (`tencent`), Tencent
AI Studio, or CodeBuddy. Those are separate provider identities and credentials.
Only the two Yuanbao cookie values and `hy_source=web` are sent to Yuanbao.
The connection test checks the cookie shape and reports a skipped probe: it does
not create a conversation or establish that the session is valid. A 401 or 403
from Yuanbao during a request indicates that the session may have expired; obtain
a fresh authorized session through the service and update the connection.

Model discovery returns the registry's static Yuanbao list without a network
request. Chat creates a conversation and posts a message to Yuanbao, translating
its text and reasoning SSE events into OpenAI-style responses. Redirects are
rejected for both requests. Availability, model names, authentication expiry and
stream formats can change upstream; the offline mock tests cannot establish live
service compatibility or that any particular session is authorized.

## Pinned source contracts

- CLIProxyAPI [`sdk/cliproxy/service_executors.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/service_executors.go) and [`sdk/cliproxy/auth/classification.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/auth/classification.go) enumerate its native execution and credential paths; the pinned inventory records no native Yuanbao Web integration. Generic configured endpoints do not establish a Yuanbao cookie contract.
- EasyCLIProxyAPI [`src/pages/EasyModePage.tsx`](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src/pages/EasyModePage.tsx) and [`src-tauri/src/management_api.rs`](https://github.com/router-for-me/EasyCLIProxyAPI/blob/e4223d5eefa22a3301ca7e2a28d05897432b07f9/src-tauri/src/management_api.rs) provide guided setup and delegate runtime to its separately versioned CLIProxyAPI core and plugins. They do not define a built-in Yuanbao session flow; installed plugins and core versions remain outside this conclusion.
- OmniRoute [`open-sse/executors/yuanbao-web.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/executors/yuanbao-web.ts) specifies the cookie, conversation creation, model mapping, and SSE request/response flow. Its [`open-sse/config/providers/registry/yuanbao-web/index.ts`](https://github.com/cheaper-inference/OmniRoute/blob/ab180e32fcdf1f78c96f98a617e17c86e34bf5aa/open-sse/config/providers/registry/yuanbao-web/index.ts) supplies the static model roster. DurinDoor ports that executor path; it requires both nonempty cookie values locally even though the upstream fallback accepts a token-only input.

The focused regression uses fake credentials and closed outbound mocks. No live
account, provider call, browser, or credential extraction was used.

## Saved-cookie lifecycle (#2034)

Offline lifecycle evidence is `tests/unit/provider-cookie-lifecycle-muse-yuanbao-hugging.test.js`. It uses the real database, provider routes, validate and test routes, `/v1/models`, `handleChat`, the Messages and Responses routes, account fallback, executors and the usage route; only credentials and outbound bytes are synthetic, and `fetch` is closed by default. The source pins above are the 2026-11-20 snapshot and were reused, not re-fetched. No provider request, real session, browser or Docker was used.

Verified: create (secret not echoed), incomplete cookie rejected by Validate and at dispatch with 401 and no request, Validate and Test Connection skipped without any outbound request, static catalog in `/v1/models`, JSON and SSE through Chat Completions, Messages and Responses, only `hy_source`, `hy_user` and `hy_token` sent and only to `yuanbao.tencent.com`, per-account cookie isolation, 401 and 403 fallback to a sibling with the sibling's row untouched, actionable 401 or 403 without echoing the cookie when no sibling exists, 429 kept as rate limiting, and recovery after re-paste through `PUT /api/providers/[id]`.

Gap found and fixed (DurinDoor-original; no upstream file was copied): `GET /api/usage/[connectionId]` reported "not available" for saved Yuanbao sessions although dispatch works. It now returns the local 30-day history, as for ChatGPT Web and Grok Web.

Known limits, unchanged: redirects are refused, so a login redirect surfaces as a 502; no cookie rotation write-back; no remote quota; the OmniRoute `yuanbao-web.ts` pin remains the only parity reference.
