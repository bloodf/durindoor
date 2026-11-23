# iFlow compatibility investigation (#2034)

## Upstream status

The pinned trees requested for this pass contain no iFlow paths: [CLIProxyAPI `6eb8554f0ede`](https://github.com/router-for-me/CLIProxyAPI/tree/6eb8554f0ede) and [OmniRoute `5ffa68e83544`](https://github.com/cheaper-inference/OmniRoute/tree/5ffa68e83544). Both recursive Git tree responses were complete, not truncated.

- CLIProxyAPI removed the iFlow auth modules, executor, tests and references in [`f5dc6483d5bfdc254938f91e824a45afb0774005`](https://github.com/router-for-me/CLIProxyAPI/commit/f5dc6483d5bfdc254938f91e824a45afb0774005). The commit describes the removal but does not state its underlying reason.
- OmniRoute migrated the iFlow provider to Qoder AI in [`a5393a3ec4e717f2ef97fe4f66f3bc836c996ba2`](https://github.com/cheaper-inference/OmniRoute/commit/a5393a3ec4e717f2ef97fe4f66f3bc836c996ba2), renaming the executor and OAuth service and provider files. The commit describes a migration but does not state why it was made. Later, [`888ce1a73b05109d50b8968381c5b9370fb2fc1c`](https://github.com/cheaper-inference/OmniRoute/commit/888ce1a73b05109d50b8968381c5b9370fb2fc1c) removed the leftover refresh-lead entry because the provider had already been removed and nothing dispatched to it.

Neither pinned upstream supplies an iFlow implementation to compare or port for this pass. This does not establish whether iFlow itself remains available.

Comparison on 2026-11-20, against the default-branch heads fetched on that date:

- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d), revision `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`: no iFlow references in the checked source tree. No current iFlow OAuth, refresh, model, chat or quota contract was found there.
- [EasyCLIProxyAPI](https://github.com/router-for-me/EasyCLIProxyAPI/tree/e4223d5eefa22a3301ca7e2a28d05897432b07f9), revision `e4223d5eefa22a3301ca7e2a28d05897432b07f9`: no iFlow references in the checked source tree. `src-tauri/src/management_api.rs` delegates general OAuth to the managed core; `core-version.txt` identifies core version 8.0.63. This does not establish an iFlow contract.
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute/tree/e3c1531afd07d5e06f7ffab658584a7ae2e3627e), revision `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`: no iFlow implementation found in `src/` or `open-sse/`. `CHANGELOG.md` says the provider was removed, and attributes removal of the leftover refresh TTL to [#8966](https://github.com/diegosouzapw/OmniRoute/pull/8966).

No current upstream implementation was available to establish parity. No upstream logic was ported. Absence in these projects does not establish that iFlow itself has withdrawn service or that the retained integration is currently accepted by the provider.

Locally, the dashboard uses `src/lib/oauth/providers.js` and `src/app/api/oauth/[provider]/[action]/route.js` for authorization, exchange and flow-bound state. User info supplies an API key separately from OAuth tokens. `open-sse/services/tokenRefresh/providers.js` refreshes OAuth tokens; `open-sse/executors/iflow.js` prefers the API key for chat and retains an access-token fallback. The registry's model list is static, not a live model discovery endpoint. `open-sse/services/usage/misc.js` reports a local message rather than provider quota. The base executor handles HTTP errors and relays streams.

The separate CLI flow in `src/lib/oauth/services/iflow.js` generates state but does not compare the callback state before exchanging a code. This remains an unresolved security concern. The dashboard's flow-bound state check does not cover that CLI path.

`tests/unit/iflow-signin-parity.test.js` uses fake credentials and closed fetch mocks to exercise the retained dashboard OAuth exchange, refresh, static list, chat stream, an upstream 429 and local quota message. It does not verify provider acceptance, full gateway error mapping, the CLI callback or live quota. No provider, browser or credential access is needed for these tests.
