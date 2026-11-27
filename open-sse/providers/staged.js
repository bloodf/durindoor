/** Executors that are not yet reachable through provider dispatch.
 * A catalog entry can exist while its specialized executor remains staged.
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
