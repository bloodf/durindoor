# iFlow compatibility investigation (#2034)

Comparison on 2026-11-20, against the default-branch heads fetched on that date:

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d), revision `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`: no iFlow references in the checked source tree. No current iFlow OAuth, refresh, model, chat or quota contract was found there.
- [EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI/tree/e4223d5eefa22a3301ca7e2a28d05897432b07f9), revision `e4223d5eefa22a3301ca7e2a28d05897432b07f9`: no iFlow references in the checked source tree. `src-tauri/src/management_api.rs` delegates general OAuth to the managed core; `core-version.txt` identifies core version 8.0.63. This does not establish an iFlow contract.
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute/tree/e3c1531afd07d5e06f7ffab658584a7ae2e3627e), revision `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`: no iFlow implementation found in `src/` or `open-sse/`. `CHANGELOG.md` says the provider was removed, and attributes removal of the leftover refresh TTL to [#8966](https://github.com/diegosouzapw/OmniRoute/pull/8966).

No current upstream implementation was available to establish parity. No upstream logic was ported. Absence in these projects does not establish that iFlow itself has withdrawn service or that the retained integration is currently accepted by the provider.

Locally, the dashboard uses `src/lib/oauth/providers.js` and `src/app/api/oauth/[provider]/[action]/route.js` for authorization, exchange and flow-bound state. User info supplies an API key separately from OAuth tokens. `open-sse/services/tokenRefresh/providers.js` refreshes OAuth tokens; `open-sse/executors/iflow.js` prefers the API key for chat and retains an access-token fallback. The registry's model list is static, not a live model discovery endpoint. `open-sse/services/usage/misc.js` reports a local message rather than provider quota. The base executor handles HTTP errors and relays streams.

The separate CLI flow in `src/lib/oauth/services/iflow.js` generates state but does not compare the callback state before exchanging a code. This remains an unresolved security concern. The dashboard's flow-bound state check does not cover that CLI path.

`tests/unit/iflow-signin-parity.test.js` uses fake credentials and closed fetch mocks to exercise the retained dashboard OAuth exchange, refresh, static list, chat stream, an upstream 429 and local quota message. It does not verify provider acceptance, full gateway error mapping, the CLI callback or live quota. No provider, browser or credential access is needed for these tests.
