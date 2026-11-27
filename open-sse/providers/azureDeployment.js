import { isString } from "../../src/shared/utils/typeChecks.js";

/**
 * Parse a comma-separated list of Azure OpenAI deployment names into unique,
 * trimmed non-empty strings.
 * Upstream provenance: decolua/9router#5901.
 *
 * @param {unknown} names
 * @returns {string[]}
 */
export function parseAzureDeploymentNames(names) {
  if (!isString(names)) return [];
  return [...new Set(names.split(",").map((name) => name.trim()).filter(Boolean))];
}

/**
 * Return the configured deployment pool for an Azure connection when
 * `providerSpecificData.deploymentMode === "pool"`, or `[]` for legacy
 * single-deployment connections.
 * Upstream provenance: decolua/9router#5901.
 *
 * @param {Record<string, unknown>|null|undefined} data
 * @returns {string[]}
 */
export function getAzureDeploymentPool(data) {
  return data?.deploymentMode === "pool" && Array.isArray(data.enabledModels)
    ? data.enabledModels.filter((name) => isString(name) && name.trim()).map((name) => name.trim())
    : [];
}
