export default {
  id: "iflytek",
  priority: 70,
  alias: "iflytek",
  display: {
    name: "iFlytek Spark",
    icon: "bot",
    color: "#0EA5E9",
    textIcon: "IF",
    website: "https://www.xfyun.cn",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://spark-api.xf-yun.com/v1/chat/completions",
    validateUrl: "https://spark-api.xf-yun.com/v1/models",
    authHeader: "bearer",
  },
  models: [
    { id: "4.0Ultra", name: "Spark 4.0 Ultra", contextLength: 32768 },
    { id: "generalv3.5", name: "Spark Max (V3.5)" },
    { id: "max-32k", name: "Spark Max 32K", contextLength: 32768 },
    { id: "generalv3", name: "Spark Pro", contextLength: 8192 },
    { id: "pro-128k", name: "Spark Pro 128K", contextLength: 131072 },
    { id: "lite", name: "Spark Lite", contextLength: 4096 },
  ],
  serviceKinds: ["llm"],
};
