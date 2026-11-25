# #1073 CLIProxyAPI runtime registration audit

Compared OmniRoute #915 at head `dd33dc1f9bb786f9996a27d0ae65517d4ec1b229` and merge `0f75387f419599707db3244d6776fcb3e2833d33` with the local runtime at `ea00dcfa1aef7b70f39bb0b84ea46a7c7970ce0a`. Source was inspected from the pinned repository at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`.

## Finding

There is one existing dispatch defect relevant to #915: the local provider-level CLIProxyAPI routing resolver is not in the chat execution path. `open-sse/handlers/chatCore/executorProxy.js` implements `resolveExecutorWithProxy`, including native, sidecar, and fallback modes, but repository search shows no caller outside its tests. `open-sse/handlers/chatCore.js` instead obtains `getExecutor(provider)` directly. Consequently the already persisted `upstream_proxy_config` settings and model mappings do not affect ordinary chat dispatch. This is an unreachable existing behavior path, not a reason to add new configuration.

The sidecar's dedicated local executor in `open-sse/executors/cliproxyapi.js` is also not listed in `open-sse/executors/index.js`; the registered CLIProxyAPI provider therefore currently falls through to `DefaultExecutor`, whose transport is supplied by the registry. That registry entry declares `category: "apikey"`, bearer auth, and a loopback OpenAI-compatible destination. Direct requests to the `cliproxyapi` provider can still use this registry transport; the missing specialized registration alone does not establish a runtime failure for that direct route. The provable defect is the orphaned resolver preventing configured provider dispatch from selecting the sidecar.

## Boundaries and invariants

- **Destination:** preserve provider destinations and the existing operator-configured sidecar URL resolution. Do not infer or introduce a new destination, model alias, or routing mode.
- **Credential ownership:** the sidecar connection's saved API key is the sidecar client credential. Native provider credentials remain owned by the native provider connection. A sidecar fallback may receive the native connection credential only where the existing per-provider proxy contract explicitly does so; it must not replace or persist credentials as another provider's key.
- **Admission:** retain the existing mandatory client API-key admission in `src/sse/handlers/chat.js` (`requireApiKey` check) before provider execution. A provider's executor `noAuth` flag concerns upstream authorization and cannot bypass gateway client admission.
- **Authentication:** preserve registry `category: "apikey"` and bearer behavior for direct CLIProxyAPI connections. Keep upstream auth selection and refresh behavior tied to the native provider executor; do not make the sidecar itself refresh credentials or broaden no-auth treatment.
- **Refresh:** the existing resolver wraps the sidecar executor while binding the native executor's `refreshCredentials`; preserve that native refresh ownership and credential update callback. Do not introduce or overlap sign-in/import changes.

## Safe implementation contract

Wire the existing resolver into the established chat executor selection point, passing the selected provider, log context, and that connection's `providerSpecificData`. Ensure the resulting executor continues through the normal credential selection, mandatory admission, response accounting, and native refresh/update path. Register the specialized executor only if the selected resolver requires it, and retain the registry-backed direct provider route and its API-key requirement. Keep scope to this runtime dispatch repair; do not add configuration, alter destinations, move credential ownership, change admission/auth policy, or include sign-in work.

## Evidence limits

This is a static comparison of the specified source merge and local source. No network calls, credentials, provider traffic, runtime security scenarios, or tests were exercised.
