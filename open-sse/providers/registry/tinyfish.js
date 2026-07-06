export default {
  id: "tinyfish",
  alias: "tinyfish",
  display: {
    name: "TinyFish Fetch",
    icon: "language",
    color: "#0891B2",
    textIcon: "TF",
    website: "https://docs.tinyfish.ai/fetch-api",
    notice: {
      text: "Fetch does not use TinyFish credits. DurinDoor fetches one URL per request.",
      apiKeyUrl: "https://agent.tinyfish.ai/api-keys"
    }
  },
  category: "apikey",
  authType: "apikey",
  serviceKinds: [
    "webFetch"
  ],
  fetchConfig: {
    baseUrl: "https://api.fetch.tinyfish.ai",
    method: "POST",
    authType: "apikey",
    authHeader: "x-api-key",
    costPerQuery: 0,
    freeMonthlyQuota: 0,
    formats: [
      "markdown",
      "html"
    ],
    maxCharacters: 100000,
    timeoutMs: 30000
  }
};
