import { isObject, isString } from "../../src/shared/utils/typeChecks.js";
export const BEDROCK_DEFAULT_REGION = "us-east-1";

const BEDROCK_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/i;

export function normalizeBedrockRegion(value, fallback = BEDROCK_DEFAULT_REGION) {
  if (!isString(value)) return fallback;
  const trimmed = value.trim().toLowerCase();
  return BEDROCK_REGION_PATTERN.test(trimmed) ? trimmed : fallback;
}

export function extractBedrockRegionFromBaseUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^bedrock(?:-runtime|-mantle)?\.([a-z0-9-]+)\./i);
    return match?.[1] ? normalizeBedrockRegion(match[1], "") || null : null;
  } catch {
    return null;
  }
}

export function resolveBedrockRegion(providerSpecificData) {
  const data =
  providerSpecificData && isObject(providerSpecificData) ? providerSpecificData : {};
  const explicit = normalizeBedrockRegion(data.region, "");
  if (explicit) return explicit;
  return extractBedrockRegionFromBaseUrl(data.baseUrl) || BEDROCK_DEFAULT_REGION;
}

export function buildBedrockRuntimeBaseUrl(region) {
  return `https://bedrock-runtime.${normalizeBedrockRegion(region)}.amazonaws.com`;
}

export function buildBedrockNativeConverseUrl(region, modelId, stream = false) {
  return `${buildBedrockRuntimeBaseUrl(region)}/model/${encodeURIComponent(modelId)}/${
  stream ? "converse-stream" : "converse"}`;

}

// How a Bedrock connection supplies credentials.
//
// apiKey  — a Bedrock API key sent as a bearer token. The original DurinDoor behaviour and
//           still the default when nothing else is configured.
// static  — AWS SigV4 from keys the connection carries: `apiKey` holds the AWS secret access
//           key, `providerSpecificData.accessKeyId` the key id, and `sessionToken` is set when
//           they came from STS. Selected by the presence of an access key id, so an existing
//           bearer-token connection can never be reinterpreted as one of these.
// profile — the connection names a local AWS profile and nothing else. The AWS SDK resolves it,
//           which is what makes `aws sso login --profile X` work: it reads ~/.aws/config, follows
//           `sso_session`, reads the cached token, calls GetRoleCredentials, and refreshes on
//           expiry without the connection being touched.
export const BEDROCK_CREDENTIAL_MODE = {
  API_KEY: "apiKey",
  STATIC: "static",
  PROFILE: "profile"
};

// A profile name is handed to the AWS SDK, which will follow `source_profile` role chains and
// run a `credential_process` subprocess if the named profile declares one. providerSpecificData
// carries no schema, so the name arrives as an arbitrary string and is validated before it
// reaches a credential resolver. AWS profile names allow word characters, dots, dashes and
// (for `sso-session`-style names) colons.
export const BEDROCK_PROFILE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
