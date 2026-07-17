export default {
  id: "snowflake",
  alias: "snowflake",
  display: {
    name: "Snowflake Cortex",
    icon: "ac_unit",
    color: "#29B5E8",
    textIcon: "SF",
    website: "https://www.snowflake.com",
    notice: {
      text: "Requires a Snowflake account identifier and a Cortex REST API token.",
      apiKeyUrl: "https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-rest-api",
    },
  },
  category: "apikey",
  hasProviderSpecificData: true,
  transport: {
    // DefaultExecutor resolves {accountId} from credentials.providerSpecificData.accountId.
    baseUrl: "https://{accountId}.snowflakecomputing.com/api/v2/cortex/v1/chat/completions",
  },
  models: [
    { id: "llama3.1-70b", name: "llama3.1-70b" },
    { id: "llama3.3-70b", name: "llama3.3-70b" },
    { id: "deepseek-r1", name: "deepseek-r1" },
    { id: "claude-3-5-sonnet", name: "claude-3-5-sonnet" },
  ],
};
