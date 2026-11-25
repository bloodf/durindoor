# OAuth native Node ESM imports

Refs #2313.

The OAuth provider modules under `src/lib/oauth/` load under plain Node ESM, with no bundler, Vitest alias, or loader.

## Rules for modules in the native set

- Every relative import carries its file extension (`./constants/oauth.js`, not `./constants/oauth`). Node ESM does not probe extensions or `index.js`.
- Modules reach `open-sse` by relative path (`../../../open-sse/providers/index.js`). The bare `open-sse/...` specifier is a bundler and Vitest alias, not an installed package.
- `providers.js` imports only `open-sse/utils/proxyFetch.js` for the global fetch proxy patch. It does not import `open-sse/index.js`, which pulls in the translator and handler graph.
- The bundler-only `@/` alias stays inside dynamic `import()` calls in `providers.js` (`@/lib/localDb`, `@/lib/oauth/services/qoder`), which run only inside Next.js request handlers.

## Native set

`providers.js`, `providerHelpers.js`, `cancellation.js`, `constants/oauth.js`, `constants/xai.js`, `utils/pkce.js`, the per-provider files (`orcarouterProvider.js`, `gheCopilotProvider.js`, `copilotM365Provider.js`, `museCodeProvider.js`, `openferenceProvider.js`, `freebuffProvider.js`, `workbuddyProvider.js`, `zedHostedProvider.js`), `services/devin-desktop.js`, and `services/minimax-code.js`.

Not in the set: `flowStore.js`, `flowCompletion.js`, and `proxySelection.js` reach the database through the `@/` alias, and the legacy `services/` CLI flows have their own unresolved imports. Moving either group to native ESM is separate work.

## Verification

`tests/unit/oauth-native-esm.test.js` scans the native set for extensionless relative imports and bare `open-sse` specifiers, then spawns plain `node` to import each module. It uses no network and no provider credentials.
