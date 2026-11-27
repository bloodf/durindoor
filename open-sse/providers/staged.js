/** Providers whose executor or definition is not yet reachable through dispatch.
 * A catalog entry can exist while its specialized executor remains staged.
 *
 * Keys are canonical owning-provider IDs, not module basenames. Each module in
 * open-sse/executors/staged.json names its owner in `provider`; several modules
 * share one owner (an executor, its nested helpers such as `credential.js`,
 * `errors.js` and `events.js`, and its private definition), so every owner
 * appears here exactly once. A provider leaves this map in the change that
 * registers it; until then it stays unavailable to users. `docs` points at the
 * provider's staged page, which states that it cannot be added yet.
 */
export const STAGED_PROVIDERS = {
  gigachat: {
    staged: true,
    reason: "The catalog entry uses DefaultExecutor; GigaChatExecutor is not registered.",
  },
  cliproxyapi: {
    staged: true,
    reason: "CliproxyapiExecutor is reachable only through an unused proxy module.",
  },
  "inner-ai-web": {
    staged: true,
    reason: "Executor, helpers and private definition are not registered; separate from the inner-ai API-key entry.",
    docs: "docs/providers/inner-ai-web.md",
  },
  "poe-web": {
    staged: true,
    reason: "Executor and private definition are not registered; separate from the poe API-key entry.",
    docs: "docs/providers/poe-web.md",
  },
  "v0-vercel-web": {
    staged: true,
    reason: "Executor and private definition are not registered; separate from the v0-vercel API-key entry.",
    docs: "docs/providers/v0-vercel-web.md",
  },
  "venice-web": {
    staged: true,
    reason: "Executor, helpers and private definition are not registered; separate from the venice API-key entry.",
    docs: "docs/providers/venice-web.md",
  },
  "adobe-firefly-api": {
    staged: true,
    reason: "Image-only private definition; neither the registry nor the image adapter map imports it.",
    docs: "docs/providers/adobe-firefly-api.md",
  },
  renderhour: {
    staged: true,
    reason: "Image, video and speech private definition; neither the registry nor any media adapter map imports it.",
    docs: "docs/providers/renderhour.md",
  },
};
