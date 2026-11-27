# Qwen Code sign-in parity, #2034

## Source inventory

The pinned MIT-licensed snapshots were inspected as source trees:

- [CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864](https://github.com/router-for-me/CLIProxyAPI/tree/dbe641f286a489ecb39e3c041c554371e6add864): no Qwen Code OAuth provider, executor, or token importer is present. `sdk/cliproxy/usage/accounting.go` mentions qwen as a model-family marker, not an authentication contract.
- [EasyCLIProxyAPI 29567ead8164a00724dfdc2087f02a23895636ee](https://github.com/router-for-me/EasyCLIProxyAPI/tree/29567ead8164a00724dfdc2087f02a23895636ee): Qwen references include model classification in `src-tauri/src/agents/zcode.rs`; they do not implement Qwen Code device authorization or token import.
- [OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523](https://github.com/diegosouzapw/OmniRoute/tree/b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523): `open-sse/config/providers/registry/qwen-cloud/index.ts` defines an API-key DashScope provider, not Qwen Code OAuth. `bin/cli/launch/adapters/qwen.mjs` configures the Qwen CLI as a client; it is not a Qwen OAuth provider. The source `src/lib/oauth/providers.ts` has no Qwen entry. The audio registry's `qwen` rows likewise do not establish an OAuth contract.

These snapshots do not supply a Qwen Code device, import, refresh, discovery or stream protocol to port. DurinDoor's existing Qwen implementation is the evidence for the behavior below; the separate Qwen Cloud and token-plan identities must not be conflated with it.

## DurinDoor production

The existing web provider object in `src/lib/oauth/providers.js` requests a device code with PKCE and exchanges it using the verifier. The shared `/api/oauth/[provider]/[action]` flow owns flow state, proxy selection, claims and connection storage. For sign-in, start the Qwen Code device flow from the provider UI or CLI, visit the displayed verification URL and enter the displayed code; the flow polls through the shared endpoint. The Qwen entry is hidden in the registry, so availability depends on the caller exposing it. The executor uses the token's resource URL and a static model catalog; usage reports a status message, not a quota fetch. `open-sse/services/tokenRefresh/providers.js` refreshes the token and preserves an unrotated refresh token.

`src/lib/oauth/services/qwen.js` is a separate older service. Its former credential module and `/api/cli/providers/qwen` token-save route are absent from this checkout. Its `connect` and `saveTokens` now fail before network access and direct users to the shared OAuth flow; no Qwen CLI credential-file import endpoint was found. Its standalone device poller honors expiry, cancellation, and increasing intervals on `slow_down`. The production web Qwen object still includes upstream error text on device-code failure until the staged helper is integrated.

## Staged web wiring

`src/lib/oauth/providerParity/qwen/index.js` exports `createQwenProviderHandlers(config)`. It produces the same device-code provider object shape and token mapping while returning only recognized polling error codes and a generic device request failure. `registration.json` identifies the single central integration slot. It is **not registered** and does not change production behavior. It does not provide a new gateway, flow store or credential store.

The focused tests exercise the existing provider functions with mocked transports and two account-specific proxies, recognized terminal and retryable responses, static model availability, and account-specific stream headers and hosts. The staged helper has one isolated test. Existing `tests/unit/qwen-signin-parity.test.js` covers the existing refresh mapping, device exchange, static catalog and usage message. The CLI poller tests use fake clocks and aborts for cancellation, deadline, denial and backoff. The unavailable legacy CLI import fails before network access; a real credential-file import is not implemented. The existing shared route guards own connection persistence and replay prevention; this focused test does not exercise the route end to end. No claim of full parity is made.
