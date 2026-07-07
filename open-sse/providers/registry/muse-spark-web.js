export default {
  id: "muse-spark-web",
  priority: 241,
  alias: "ms-web",
  uiAlias: "ms-web",
  display: {
    name: "Muse Spark Web",
    icon: "auto_awesome",
    color: "#0668E1",
    textIcon: "MS",
    website: "https://www.meta.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your ecto_1_sess value or the full Cookie header from meta.ai.",
  serviceKinds: ["llm"],
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "openai",
    executor: "muse-spark-web",
    authType: "cookie",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark" },
    { id: "muse-spark-thinking", name: "Muse Spark Thinking", supportsReasoning: true },
    { id: "muse-spark-contemplating", name: "Muse Spark Contemplating", supportsReasoning: true },
  ],
};
