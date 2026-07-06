export default {
  id: "modelscope",
  alias: "ms",
  display: {
    name: "ModelScope",
    icon: "hub",
    color: "#00A0E9",
    textIcon: "MS",
    website: "https://modelscope.cn",
    notice: { apiKeyUrl: "https://modelscope.cn/my/myaccesstoken" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api-inference.modelscope.cn/v1/chat/completions",
    validateUrl: "https://api-inference.modelscope.cn/v1/models",
  },
  models: [],
  modelsFetcher: { url: "https://api-inference.modelscope.cn/v1/models", type: "openai" },
  passthroughModels: true,
};
