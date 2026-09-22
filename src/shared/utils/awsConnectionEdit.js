import { isString } from "./typeChecks.js";

function trimmed(value) {
  return isString(value) ? value.trim() : "";
}

/**
 * Build the providerSpecificData and session-token parts of an edit to an AWS (Bedrock)
 * connection.
 *
 * A saved profile takes precedence over any key, so typing a new API key clears it: otherwise the
 * new key would be stored and never used. An empty profile or access key id is sent as "" so the
 * server's merge clears the saved value instead of keeping it.
 *
 * The session token is a secret the API never returns, so a blank field means "keep". It is
 * replaced anyway (possibly with "") when the access key id changes, and cleared when static
 * keys are removed: a token belongs to one key pair and would break signing for any other.
 *
 * @param {object} args
 * @param {object} [args.savedData] - The connection's current providerSpecificData.
 * @param {{ profile: string, accessKeyId: string, sessionToken: string }} args.awsData - Form state.
 * @param {string} [args.apiKey] - A newly typed API key, or "".
 * @param {string} [args.region] - Selected region.
 * @returns {{ providerSpecificData: object, sessionToken: string | undefined }}
 */
export function buildAwsConnectionEdit({ savedData = {}, awsData, apiKey = "", region = "" }) {
  const accessKeyId = trimmed(awsData?.accessKeyId);
  const typedToken = trimmed(awsData?.sessionToken);
  const providerSpecificData = {
    ...(savedData || {}),
    profile: trimmed(apiKey) ? "" : trimmed(awsData?.profile),
    accessKeyId
  };
  if (region) providerSpecificData.region = region;

  let sessionToken;
  if (!accessKeyId) sessionToken = "";
  else if (typedToken || accessKeyId !== trimmed(savedData?.accessKeyId)) sessionToken = typedToken;
  return { providerSpecificData, sessionToken };
}
