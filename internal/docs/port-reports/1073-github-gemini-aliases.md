# #1073 — GitHub Gemini legacy alias compatibility (OmniRoute #924)

## Source change

OmniRoute PR [#924](https://github.com/cheaper-inference/OmniRoute/pull/924), pinned at final head `a7fa34c2fcecfe71bdde16e935f4731d4fa803b1` (merged as `24721cf2fafae0ad735dcfa2863dcb9a44edd0f2`), was compared from the private Git mirror at `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` using the first-parent patch `2ab41a359eceec4dc0b0bd60bf59a058e0ba8d5c..24721cf2fafae0ad735dcfa2863dcb9a44edd0f2`. That patch touches:

- `open-sse/config/providerRegistry.ts` — adds `gemini-3.1-pro-preview` to the GitHub Copilot model list (plus an unrelated try/catch reformat).
- `open-sse/services/model.ts` — extends the provider-scoped `PROVIDER_MODEL_ALIASES.github` map: `gemini-3-pro` → `gemini-3.1-pro-preview` (retargeted from `gemini-3-pro-preview`) and a new `gemini-3-pro-preview` → `gemini-3.1-pro-preview` entry. The mapping is applied by `resolveProviderModelAlias()` from `getModelInfoCore()`, for both the direct `provider/model` branch and the user-alias branch.
- `README.md`, `docs/USER_GUIDE.md` — documentation examples switched from `gh/gemini-3-pro` to `gh/gemini-3.1-pro-preview`.
- `tests/unit/t28-model-catalog-updates.test.mjs` — fixture asserting the canonical id and the legacy id both resolve to provider `github` with model `gemini-3.1-pro-preview`.

## Local comparison

- The catalog half was already integrated locally: `open-sse/providers/registry/github.js` lists `gemini-3.1-pro-preview` ("Gemini 3.1 Pro"), and `tests/unit/github-responses-routing.test.js` exercises that model at runtime. No catalog entry, provider, sign-in change or endpoint was added by this port.
- The compatibility half was missing: neither `open-sse/services/model.js` nor `src/sse/services/model.js` had any provider-scoped model alias table, so `github/gemini-3-pro` and `gh/gemini-3-pro` resolved to a retired model id. This was already recorded as an outstanding candidate in `internal/docs/port-reports/1073-april-provider-models.md` (§ #924); no other port report claimed it, and no earlier commit in this branch carried the mapping.
- The local resolution path is the same shape as upstream but in JavaScript: `open-sse/services/model.js` holds `parseModel()`, `resolveProviderAlias()`, `resolveModelAliasFromMap()` and `getModelInfoCore()`; `src/sse/services/model.js` holds the gateway entry point `getModelInfo()` used by the SSE/chat handlers.

## Ported change

Product edits are limited to `open-sse/services/model.js` and `src/sse/services/model.js`.

- `open-sse/services/model.js` — added a provider-scoped `PROVIDER_MODEL_ALIASES` table with the single GitHub entry set (`gemini-3-pro` → `gemini-3.1-pro-preview`, `gemini-3-pro-preview` → `gemini-3.1-pro-preview`) and an exported `resolveProviderModelAlias(providerOrAlias, modelId)` helper that resolves the provider alias first (`gh` → `github`) and looks the model up in that provider's map only.
- `open-sse/services/model.js` — `getModelInfoCore()` now normalizes the model id in the scoped `provider/model` branch and in the branch that resolves an operator-defined alias, so an alias whose target explicitly names the GitHub provider is normalized on the same path.
- `src/sse/services/model.js` — the gateway entry point `getModelInfo()` normalizes the model id it returns for a scoped request, so every handler that resolves `provider/model` (chat, count-tokens, native provider, media endpoints) routes the legacy ids to the current catalog model.

Behavior deliberately preserved:

- Canonical ids are untouched (`gh/gemini-3.1-pro-preview` still resolves to `github` + `gemini-3.1-pro-preview`).
- Bare Gemini names are untouched: `gemini-3-pro` without a provider prefix still infers provider `gemini` and keeps its own model id.
- Other providers are untouched: `gemini/gemini-3-pro` and `gemini-cli/gemini-3-pro-preview` keep their current routing; the alias table is provider-scoped.
- Case behavior is untouched: matching is exact, so `gh/GEMINI-3-PRO` is not rewritten.
- User-defined alias precedence is untouched: the alias map is consulted first, and an alias bound to a non-GitHub provider keeps its target verbatim.

Not ported (out of the requested scope, and not needed locally): the upstream README/USER_GUIDE example edits — the local public docs contain no `gh/gemini-3-pro` example — and the upstream registry catalog entry, which is already present locally and must not be duplicated.

## Interaction note

API-key model policies are canonicalized through the same resolver (`getModelInfo`) and are matched against the resolved `provider/model` identity, so both sides now speak `github/gemini-3.1-pro-preview`. A policy row saved before this port that names `github/gemini-3-pro` keeps its stored spelling and therefore no longer matches the resolved identity until it is saved again through the dashboard/API, where it is re-canonicalized to the current model. This follows from the model id change itself and is not a separate behavior edit.

## Evidence collected

- Source comparison: first-parent patch of `24721cf2fafae0ad735dcfa2863dcb9a44edd0f2` and head `a7fa34c2fcecfe71bdde16e935f4731d4fa803b1` read from `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`.
- Local sources: `open-sse/services/model.js`, `src/sse/services/model.js`, `open-sse/providers/registry/github.js`.
- New offline fixture: `tests/unit/omni-github-gemini-aliases.test.js` (13 assertions over the core resolver and the gateway entry point: scoped legacy ids, canonical id, other providers, bare names, case, operator alias targeting GitHub, operator alias targeting another provider, alias precedence, and unchanged non-GitHub routing).
- Existing focused assertions re-run unchanged: the GitHub provider suites, model routing, combo, custom-capability and API-key-policy suites (all passing).
- No provider request, browser, Docker, e2e or full-suite run was performed.
- Required evidence: `rg -q -F a7fa34c2fcecfe71bdde16e935f4731d4fa803b1 internal/docs/port-reports/1073-github-gemini-aliases.md && rg -q -F 24721cf2fafae0ad735dcfa2863dcb9a44edd0f2 internal/docs/port-reports/1073-github-gemini-aliases.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-github-gemini-aliases.test.js)`.
