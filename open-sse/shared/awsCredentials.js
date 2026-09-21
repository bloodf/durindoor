import {
  BEDROCK_CREDENTIAL_MODE,
  BEDROCK_PROFILE_PATTERN } from
"../config/bedrock.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
import { fromIni } from "@aws-sdk/credential-provider-ini";

/**
 * AWS credential resolution for the Bedrock provider.
 *
 * Three shapes are supported, see BEDROCK_CREDENTIAL_MODE for what each one means. Detection
 * is ordered so that an existing bearer-token connection keeps working untouched: only a
 * connection that explicitly carries a profile or an access key id takes an AWS path.
 *
 * Nothing here reaches out on its own. Profile and SSO resolution is left to the AWS SDK,
 * which already reads ~/.aws, follows sso_session and source_profile chains, caches the
 * resolved credential and re-resolves it on expiry. Re-implementing that would buy nothing and
 * would have to be kept in step with the SDK's own credential precedence.
 */

function asRecord(value) {
  return value && isObject(value) && !Array.isArray(value) ? value : {};
}

function trimmed(value) {
  return isString(value) ? value.trim() : "";
}

/** Tag an error with the HTTP status the executor should report for it. */
function credentialError(message) {
  const error = new Error(message);
  error.name = "InvalidCredentials";
  error.status = 401;
  return error;
}

/**
 * Which credential mode a connection is configured for.
 *
 * A named profile wins over everything, because a user who filled in a profile meant to use
 * it. A static AWS key pair is selected by the access key id rather than by the API key field,
 * since that field already carries the Bedrock bearer token for existing connections.
 *
 * @param {object} credentials - Connection credentials.
 * @returns {string} One of BEDROCK_CREDENTIAL_MODE.
 */
export function detectBedrockCredentialMode(credentials) {
  const data = asRecord(credentials?.providerSpecificData);
  if (trimmed(data.profile)) return BEDROCK_CREDENTIAL_MODE.PROFILE;
  if (trimmed(data.accessKeyId)) return BEDROCK_CREDENTIAL_MODE.STATIC;
  return BEDROCK_CREDENTIAL_MODE.API_KEY;
}

function profileClientAuth(data) {
  const profile = trimmed(data.profile);
  if (!BEDROCK_PROFILE_PATTERN.test(profile)) {
    throw credentialError(
      "Invalid AWS profile name. Use the profile's name as it appears in ~/.aws/config: " +
      "letters, digits, underscore, dot, colon or hyphen, up to 64 characters."
    );
  }
  // fromIni resolves exactly this profile: shared config, SSO token cache, GetRoleCredentials,
  // source_profile chaining and credential_process, with caching and refresh. It is used on its
  // own rather than as `profile` on the client config, because that selects the default chain,
  // which moves on to web identity, ECS and IMDS when the profile fails to resolve. On an AWS
  // host that would sign as the server's own role instead of failing.
  return { credentials: fromIni({ profile }) };
}

function staticClientAuth(credentials, data) {
  const accessKeyId = trimmed(data.accessKeyId);
  const secretAccessKey = trimmed(credentials?.apiKey);
  // The session token is a secret, so it is stored as a top-level encrypted connection field.
  // providerSpecificData is plaintext; the fallback only reads rows written by 9router, which
  // kept it there.
  const sessionToken = trimmed(credentials?.sessionToken) || trimmed(data.sessionToken);

  if (!secretAccessKey) {
    throw credentialError(
      "Bedrock static credentials are incomplete. Put the AWS secret access key in the API " +
      "Key field, or set a profile instead to use a local AWS profile."
    );
  }
  // Temporary keys (ASIA...) are useless without their session token. Catching it here turns a
  // confusing upstream SignatureDoesNotMatch into something the user can act on.
  if (accessKeyId.startsWith("ASIA") && !sessionToken) {
    throw credentialError(
      "This looks like a temporary AWS access key (ASIA...) but no session token was " +
      "provided. Add the session token, or use a profile so credentials are resolved and " +
      "refreshed automatically."
    );
  }

  const resolved = { accessKeyId, secretAccessKey };
  if (sessionToken) resolved.sessionToken = sessionToken;
  return { credentials: resolved };
}

function apiKeyClientAuth(credentials) {
  const apiKey = trimmed(credentials?.apiKey);
  if (!apiKey) {
    throw credentialError(
      "Missing Bedrock credentials. Provide a Bedrock API key, an AWS profile, or an AWS " +
      "access key id together with its secret access key."
    );
  }
  return { token: { token: apiKey }, authSchemePreference: ["httpBearerAuth"] };
}

/**
 * Check a profile name arriving at an API boundary, before it is stored or handed to the SDK.
 *
 * The executor validates again at use, but a stored profile is resolved by the AWS SDK as the
 * server user (SSO cache, `source_profile`, `credential_process`), so the routes also refuse a
 * malformed one up front and decide who may set one at all.
 *
 * @param {object} providerSpecificData - Incoming providerSpecificData.
 * @returns {{ profile: string, error?: string }} The trimmed profile ("" when none), or an error.
 */
export function checkBedrockProfileInput(providerSpecificData) {
  const raw = asRecord(providerSpecificData).profile;
  if (raw === undefined || raw === null) return { profile: "" };
  if (!isString(raw)) return { profile: "", error: "AWS profile must be a string" };
  const profile = raw.trim();
  if (profile && !BEDROCK_PROFILE_PATTERN.test(profile)) {
    return { profile: "", error: "Invalid AWS profile name" };
  }
  return { profile };
}

/**
 * Build the auth half of a BedrockRuntimeClient config for this connection.
 *
 * Returns only the auth fields; the caller supplies region and the rest. Throws an error
 * carrying `status: 401` when the connection is not configured usably, so the executor's
 * existing error mapping reports it as an auth failure rather than a bad gateway.
 *
 * @param {object} credentials - Connection credentials.
 * @returns {object} Partial BedrockRuntimeClient config.
 */
export function buildBedrockClientAuth(credentials) {
  const data = asRecord(credentials?.providerSpecificData);
  const mode = detectBedrockCredentialMode(credentials);
  if (mode === BEDROCK_CREDENTIAL_MODE.PROFILE) return profileClientAuth(data);
  if (mode === BEDROCK_CREDENTIAL_MODE.STATIC) return staticClientAuth(credentials, data);
  return apiKeyClientAuth(credentials);
}
