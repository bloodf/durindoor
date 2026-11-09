// Speka AI: OpenAI-compatible gateway at https://speka.me/v1.
// Endpoint, alias, display name/color/text icon and website come from the merged
// upstream OmniRoute commit 57640277 (registry entry speka/index.ts).
// The model list is discovered from GET /v1/models; no static list is published.
// Unverified: no live call was made, and no first-party quota, price or terms
// evidence was found, so no free-tier claim is asserted here.
export default {
  id: "speka",
  alias: "speka",
  display: {
    name: "Speka AI",
    icon: "route",
    color: "#DB2777",
    textIcon: "SP",
    website: "https://speka.me",
    notice: {
      text: "The model catalog comes from the live /v1/models endpoint. Confirm current quota, price and terms before use.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://speka.me/v1/chat/completions",
    validateUrl: "https://speka.me/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://speka.me/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
