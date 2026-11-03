export default {
  id: "yolo-auto",
  alias: "yolo-auto",
  display: {
    name: "Yolo-Auto",
    icon: "route",
    color: "#CA8A04",
    textIcon: "YA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://yolo-auto.com/v1/chat/completions",
    validateUrl: "https://yolo-auto.com/v1/models",
  },
  models: [
    { id: "qwen3.6-35b-a3b", name: "Qwen 3.6 35B A3B" },
  ],
  modelsFetcher: { url: "https://yolo-auto.com/v1/models", type: "openai" },
  passthroughModels: true,
  serviceKinds: ["llm"],
};
