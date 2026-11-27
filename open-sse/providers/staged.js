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
};
