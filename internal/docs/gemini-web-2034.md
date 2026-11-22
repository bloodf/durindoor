# Gemini Web port sources and registration (#2034)

Public operator guide: [`docs/providers/gemini-web.mdx`](../../docs/providers/gemini-web.mdx).

## Port sources

- OmniRoute (MIT), `release/v3.8.55` at `4265bb2ad5477450a07d3a43ea33a62c6c874878`:
  - [`open-sse/config/providers/registry/gemini/web/index.ts`](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/config/providers/registry/gemini/web/index.ts)
  - [`open-sse/executors/gemini-web.ts`](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/executors/gemini-web.ts) and `open-sse/executors/gemini-web/`
  - [`open-sse/utils/geminiCookies.ts`](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/open-sse/utils/geminiCookies.ts)
  - `validateGeminiWebProvider` in [`src/lib/providers/validation/webProvidersB.ts`](https://github.com/cheaper-inference/OmniRoute/blob/4265bb2ad5477450a07d3a43ea33a62c6c874878/src/lib/providers/validation/webProvidersB.ts)
- Service: [gemini.google.com](https://gemini.google.com). Its terms are Google's; operators are responsible for using their own account within them.
- Tracking: issue #1190, tracker #2034.

## Registration steps

Staged files, already in place:

- `open-sse/providers/private/gemini-web.js` — registry entry (default export), `geminiWebCookieProfile`, `GEMINI_WEB_MODELS`
- `open-sse/executors/gemini-web.js` — `GeminiWebExecutor`, `validateGeminiWebSession`, cookie helpers
- `tests/unit/gemini-web-provider.test.js` — composes both through isolated `vi.mocks`; remove the mocks once registered

Wire exactly these:

1. Registry promotion: move `open-sse/providers/private/gemini-web.js` to `open-sse/providers/registry/gemini-web.js` (keep the named exports or split the profile out), add the import and the entry to `open-sse/providers/registry/index.js`, and give it a unique `priority`. Keep `cookieImport` unset: the entry's `webLogin` already carries the origin and cookie names, and `cookieImportConfig()` reuses it. Add `gemini-web` to the in-page sign-in lists only if Google SSO works in the embedded page (it usually does not; leave it manual/import/extension).
2. `open-sse/executors/index.js`: import `{ GeminiWebExecutor }` from `./gemini-web.js`; add `"gemini-web": new GeminiWebExecutor()` to the executors map; add the matching `export { GeminiWebExecutor }` line.
3. Validation: in `src/app/api/providers/providerProbe.js` add `"gemini-web": validateGeminiWebSession` (import it from `open-sse/executors/gemini-web.js`) to `SPECIALTY_VALIDATORS`. REQUIRED: without it the generic probe sends the cookie as a Bearer token to gemini.google.com/app. It is a read-only GET and creates no conversation, so do NOT add `gemini-web` to `CONVERSATION_PROBE_PROVIDERS` in `src/lib/providers/conversationProbe.js`. Check `src/app/api/providers/validate/route.js` and the `[id]/test` route reach it for a cookie-auth provider.
4. Model discovery: add `gemini-web` to the local-catalog branch of `src/app/api/providers/[id]/models/fetchConnectionModels.js` (next to t3-web / adapta-web) so discovery returns `getProviderModels("gemini-web")` without a request; `modelsConfig.js` needs no entry because there is no list endpoint.
5. `extensions/provider-cookie-capture/providers.js`: add `gemini-web` with `geminiWebCookieProfile`'s `{ label: "Gemini Web", origin: "https://gemini.google.com", cookieNames: ["__Secure-1PSID", "__Secure-1PSIDTS"], cookiePrefixes: [] }`. The extension reads cookies the origin host sends, so check that `chrome.cookies` returns the `.google.com` cookies for it.
6. `extensions/provider-cookie-capture/manifest.json`: add host permission `https://gemini.google.com/*` (and the `.google.com` cookie access the manifest needs for the two cookie names); review the extension's CSP and its provider-table parity test (`tests/unit/provider-cookie-capture-extension.test.js`).
7. Dashboard import: nothing to add beyond the registry entry; confirm the import dialog lists Gemini Web and that `src/shared/utils/cookieImportContract.js` resolves the contract (`tests/unit/provider-cookie-import-contracts.test.js`). Confirm cURL, Cookie header and HAR parsing accept `.google.com` cookies for the gemini.google.com origin.
8. `src/shared/components/ProviderIcon.js` and `src/shared/ui/components/ProviderLogo.jsx`: add a `gemini-web` icon/logo (the registry display uses icon `auto_awesome`, textIcon `GW`, color `#4285F4`).
9. `docs/providers/catalog.mdx`, `docs/providers/index.mdx`, `docs/providers/meta.json`: list Gemini Web; add it to the `docs/providers/web-cookie.mdx` table (Cookie header or the two cookie values; dashboard import and extension; runnable).
10. `src/app/api/providers/[id]/models/modelsConfig.js`: no entry (see 4). `open-sse/AGENT-INDEX.md`: add the two files.
11. Stories: `src/app/(dashboard)/dashboard/providers/[id]/page.stories.jsx` and `tests/e2e/storybook-surfaces.json`, for the new provider card.
12. Dependencies: playwright is already a root dependency (1.63.0); the executor imports it lazily, so hosts without it fail only Gemini Web requests (503). Confirm the Docker/web image installs Chromium or document it.
13. Tests: in `tests/unit/gemini-web-provider.test.js` drop the registry and executor `vi.mocks` and import the real registry entry; keep the playwright mock. Run the provider-cookie-import and extension suites.
14. Close issue #1190 in the registration commit (`Closes #1190`, `Refs #2034`).
