export default {
  id: "bedrock",
  priority: 95,
  alias: "bedrock",
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
    { id: "openai.gpt-oss-120b-1:0", name: "GPT-OSS 120B (Bedrock)" },
  ],
  passthroughModels: true,
};
