import { isObject, isString } from "../../../src/shared/utils/typeChecks.js";

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
    stream ? "converse-stream" : "converse"
  }`;
}

// How a Bedrock connection supplies credentials.
//
// apiKey  — a Bedrock API key sent as a bearer token. The original DurinDoor behaviour and
//           still the default when nothing else is configured.
// static  — AWS SigV4 from keys the connection carries: `apiKey` holds the AWS secret access
//           key, `providerSpecificData.accessKeyId` the key id, and the encrypted top-level
//           `sessionToken` is set when they came from STS. Selected by the presence of an access key id, so an existing
//           bearer-token connection can never be reinterpreted as one of these.
// profile — the connection names a local AWS profile and nothing else. The AWS SDK resolves it,
//           which is what makes `aws sso login --profile X` work: it reads ~/.aws/config, follows
//           `sso_session`, reads the cached token, calls GetRoleCredentials, and refreshes on
//           expiry without the connection being touched.
export const BEDROCK_CREDENTIAL_MODE = {
  API_KEY: "apiKey",
  STATIC: "static",
  PROFILE: "profile",
};

// A profile name is handed to the AWS SDK, which will follow `source_profile` role chains and
// run a `credential_process` subprocess if the named profile declares one. providerSpecificData
// carries no schema, so the name arrives as an arbitrary string and is validated before it
// reaches a credential resolver. AWS profile names allow word characters, dots, dashes and
// (for `sso-session`-style names) colons.
export const BEDROCK_PROFILE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export default {
  id: "bedrock",
  priority: 95,
  alias: "bedrock",
  // Upstream 9router #1694 short prefix: `br/<model>` routes to Bedrock.
  aliases: ["br"],
  uiAlias: "bedrock",
  display: {
    name: "Amazon Bedrock",
    icon: "cloud",
    color: "#FF9900",
    textIcon: "BR",
    website: "https://aws.amazon.com/bedrock",
    notice: {
      text:
        "Uses Amazon Bedrock native Converse APIs. Pick the AWS region where your models are " +
        "enabled, then authenticate one of three ways. SSO / profile (recommended): fill in " +
        "AWS Profile, leave the API key empty, and run `aws sso login --profile <name>` — " +
        "credentials refresh automatically. Static AWS keys: put the AWS secret access key in " +
        "the API Key field and the key id in Access Key ID, adding Session Token for temporary " +
        "(ASIA...) keys. Bedrock API key: paste it in the API Key field on its own. A profile, " +
        "if set, takes precedence.",
      apiKeyUrl: "https://aws.amazon.com/bedrock",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  // In profile/SSO mode the connection carries no API key at all: the credential lives in the
  // local AWS config. This names the providerSpecificData field that stands in for one, so the
  // create and validate routes accept an empty key instead of rejecting the documented setup.
  apiKeyOptionalWith: "profile",
  // Which credential form the dashboard should render. Declared rather than keyed off the
  // provider id so a later AWS entry gets the same form without another special case.
  credentialForm: "aws",
  regions: [
    { id: "us-east-1", label: "US East (N. Virginia)" },
    { id: "us-west-2", label: "US West (Oregon)" },
    { id: "eu-west-1", label: "Europe (Ireland)" },
    { id: "eu-west-2", label: "Europe (London)" },
    { id: "eu-central-1", label: "Europe (Frankfurt)" },
    { id: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
  ],
  defaultRegion: "us-east-1",
  transport: {
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    format: "openai",
    regions: {
      "us-east-1": "https://bedrock-runtime.us-east-1.amazonaws.com",
      "us-west-2": "https://bedrock-runtime.us-west-2.amazonaws.com",
      "eu-west-1": "https://bedrock-runtime.eu-west-1.amazonaws.com",
      "eu-west-2": "https://bedrock-runtime.eu-west-2.amazonaws.com",
      "eu-central-1": "https://bedrock-runtime.eu-central-1.amazonaws.com",
      "ap-northeast-1": "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
    },
    defaultRegion: "us-east-1",
  },
  models: [
    {
      id: "anthropic.claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
    },
    {
      id: "anthropic.claude-sonnet-4-5",
      name: "Claude Sonnet 4.5 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 200000,
    },
    {
      id: "anthropic.claude-opus-4-6",
      name: "Claude Opus 4.6 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
    },
    {
      id: "anthropic.claude-opus-4-7",
      name: "Claude Opus 4.7 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
    },
    {
      id: "anthropic.claude-haiku-4-5",
      name: "Claude Haiku 4.5 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
    },
    {
      id: "anthropic.claude-fable-5-2",
      name: "Claude Fable 5.2 (Bedrock)",
      toolCalling: true,
      supportsVision: true,
      contextLength: 1000000,
    },
    { id: "openai.gpt-oss-120b-1:0", name: "GPT-OSS 120B (Bedrock)" },
  ],
  passthroughModels: true,
};
