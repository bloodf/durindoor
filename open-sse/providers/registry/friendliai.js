export default {
  id: "friendliai",
  alias: "friendli",
  display: {
    name: "FriendliAI",
    icon: "diversity_3",
    color: "#E11D48",
    textIcon: "FR",
    website: "https://friendli.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  models: [
    { id: "meta-llama-3.1-70b-instruct", name: "meta-llama-3.1-70b-instruct" },
    { id: "meta-llama-3.1-8b-instruct", name: "meta-llama-3.1-8b-instruct" },
  ],
  modelsFetcher: { url: "https://api.friendli.ai/serverless/v1/models", type: "openai" },
  passthroughModels: true,
};
