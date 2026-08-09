# Upstream Sync Plan — Workstream A2-a Ports Ledger

Scope: the six low-risk `decolua/9router` commits from group A2-a of the DurinDoor upstream sync plan, ported into `port/upstream-a2a-low-risk` off `origin/main` (`ee1eddf1e`).

| Item | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| `0e5da70c` free/apikey provider cards missing `authModes` default | PORTED | `providerFilters.js`'s page-local `getFreeAuthTypes` returned an empty auth-type list for providers such as Cloudflare/Ollama that lack a declared `authModes`, hiding the apikey fallback the free-tier card relies on. | Exported `getFreeAuthTypes` from `providerFilters.js` with the upstream apikey/oauth fallback and wired `page.js` to import it; added `tests/unit/provider-free-auth-types.test.js`. |
| `918b3c87` dynamic compatible-provider Apply button | PORTED | `getAllAvailableModels()` in `ToolDetailClient.js` only collected models from the static `PROVIDER_MODELS` catalog; openai/anthropic-compatible connections (random-UUID provider IDs) resolved to zero models, so `hasActiveProviders` went false and the Apply button stayed disabled even though the connection worked. | Extracted `fallbackConnectionModels(connection)` into `src/app/(dashboard)/dashboard/cli-tools/connectionModels.js` (default model + custom models, dedup, `active`-only placeholder) and call it from `getAllAvailableModels()` when the catalog has no entries; added `tests/unit/cli-tool-compatible-models.test.js`. |
| `ae4f76c4` active-session `/login` redirect | PORTED | `GET /api/auth/status` didn't expose an explicit `authenticated` boolean and `/login` rendered the login form even for an already-authenticated session (no redirect on load). | Added explicit `authenticated` to the status route response and a redirect-when-authenticated effect in `src/app/login/page.js`; added `tests/unit/auth-status.test.js`. |
| `d6df6576` Ollama registry API-key auth | PORTED | `open-sse/providers/registry/ollama.js` had a working apikey usage path but no top-level `authType`/`authModes`, so the free-tier provider card couldn't classify it. | Added `authType: "apikey"`, `authModes: ["apikey"]` to the registry entry; covered by `tests/unit/provider-display-split.test.js`. |
| `646b3b9b` Cloudflare AI registry API-key auth | PORTED | Same defect as `d6df6576` for `open-sse/providers/registry/cloudflare-ai.js`. | Added `authType: "apikey"`, `authModes: ["apikey"]` to the registry entry; covered by `tests/unit/provider-display-split.test.js`. |
| `948dd8f8` declare `searchParams` in OIDC `register-session` route | NOT APPLICABLE | Upstream's `POST` handler in `src/app/api/oauth/[provider]/[action]/route.js` referenced a bare `searchParams` in a `register-session` action branch without declaring it (`ReferenceError` → 500). DurinDoor's `POST` handler (lines 753-809) has no `register-session` action and never references a bare `searchParams`; the only `searchParams` usage is the destructured `const { searchParams } = new URL(request.url)` in `GET` (line 697), which is already correctly scoped. | No port — the bug cannot occur in this fork's code. |

## Registry generation

`open-sse/providers/registry/index.js` regenerated via `npm run gen:registry-index` after the `ollama.js`/`cloudflare-ai.js` edits and verified with `npm run check:registry-index` ("registry/index.js is up to date.").

## Verification

- Focused Vitest runs (via worktree-local `node_modules`/`tests/node_modules` symlinks, `tests/vitest.config.js`) passed after every port:
  - `unit/auth-status.test.js`
  - `unit/provider-free-auth-types.test.js`
  - `unit/provider-display-split.test.js`
  - `unit/cli-tool-compatible-models.test.js`
- Revert-proof: for each ported behavior, reverting the source change (registry fields removed via `sed`, `connectionModels.js` moved aside) turned the matching regression test RED before the source was restored and re-verified GREEN.
- `npx commitlint --from=origin/main --to=HEAD` passed for every commit on this branch.
- Full suite / lint / build were intentionally NOT run here per the orchestrator's instruction; the orchestrator runs those once at the end.
