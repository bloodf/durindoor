// Staged: not imported by production code. See registration.json.
import { isRecord } from "../../../../shared/utils/typeChecks.js";
import { normalizeGitLabRoot } from "./directAccess.js";

/**
 * Bind a GitLab Duo token request to the selected connection. The token URL and
 * client ID come from the connection; the deployment client secret is attached
 * only when the connection uses the deployment's own instance and client.
 */
export function bindGitLabOAuthClient(providerSpecificData, deployment = {}) {
  const data = isRecord(providerSpecificData) ? providerSpecificData : {};
  const root = normalizeGitLabRoot(data.baseUrl || deployment.baseUrl || "https://gitlab.com");
  if (!root) return null;
  const clientId = String(data.clientId || deployment.clientId || "");
  const deploymentRoot = normalizeGitLabRoot(deployment.baseUrl || "https://gitlab.com");
  const ownsSecret = Boolean(deployment.clientSecret) && deploymentRoot === root &&
    Boolean(clientId) && clientId === deployment.clientId;
  return Object.freeze({
    root,
    tokenUrl: `${root}/oauth/token`,
    clientId,
    clientSecret: ownsSecret ? deployment.clientSecret : "",
    dedupKey: `gitlab-duo:${root}:${clientId}`
  });
}
