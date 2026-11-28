# TokenRouter quota adapter staging

Source: [9router #3047](https://github.com/decolua/9router/pull/3047), frozen commit `c088ba7e1175b425f30e14227781aa80c750d719`. The adapter is adapted from `open-sse/services/usage/tokenrouter.js` under the upstream MIT license.

The single canonical implementation is `open-sse/services/usage/tokenrouterQuotaAdapter.js`, exporting `getTokenRouterUsage(connection, proxyOptions)`. It uses only the existing decrypted top-level `connection.managementApiKey`, never the inference key or a plaintext provider-specific alias. It reads fixed authenticated management endpoints, requests no redirects and refuses relays. Selected proxies receive strict routing rather than a direct fallback.

The adapter reports wallet and key-quota measurements without inferring inference readiness or a free allowance. Unlimited keys and non-expiring keys are represented explicitly. A failed wallet read can return partial key quotas with an unavailable notice. Transport and parsing failures return constant sanitized messages. Only the first 100 keys are requested, and partial-list notices remain visible.

This is an unadvertised staging change. No registry flag, usage-handler import, credential UI, validation probe or public routing is enabled. The handoff manifest lists activation prerequisites. Mocked-network tests do not establish live provider behavior, real proxy deployment correctness or caller cancellation through a public route. The remaining source PR includes management-key controls and quota presentation and is not declared fully ported here.
