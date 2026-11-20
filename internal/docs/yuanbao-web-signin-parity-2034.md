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
