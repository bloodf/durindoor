export default {
  id: "aihorde",
  priority: 90,
  alias: "horde",
  uiAlias: "horde",
  display: {
    name: "AI Horde",
    icon: "aihorde.png",
    color: "#5C6BC0",
    textIcon: "AH",
    website: "https://aihorde.net",
    notice: {
      text: "Crowdsourced volunteer inference has variable availability, queues, and model limits. Anonymous requests run at lower priority; add an AI Horde API key for account-backed priority. Images are text-to-image b64_json only, wait in a volunteer queue, and record cost as unknown (kudos are not priced).",
      apiKeyUrl: "https://aihorde.net/register",
    },
  },
  category: "free",
  noAuth: true,
  authType: "apikey",
  authModes: ["apikey"],
  authHint: "Optional AI Horde API key. Without one, DurinDoor uses AI Horde's official anonymous sentinel key.",
  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    baseUrls: ["https://oai.aihorde.net/v1/chat/completions"],
    format: "openai",
    noAuth: true,
    headers: { Authorization: "Bearer 0000000000" },
    auth: { combined: true, header: "Authorization", scheme: "bearer" },
  },
  models: [],
  modelsFetcher: { url: "https://oai.aihorde.net/v1/models", type: "openai" },
  passthroughModels: true,
  // Chat uses the facade transport above. Images use AI Horde's native job API
  // through the `aihorde` image adapter, which owns its origin and headers;
  // image models come from the live worker catalog, never from this file.
  serviceKinds: ["llm", "image"],
};
