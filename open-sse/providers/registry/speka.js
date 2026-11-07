// Contract: https://speka.me/docs. Live service behavior is not verified.
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
