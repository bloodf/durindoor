export default {
  id: "qianfan",
  alias: "qianfan",
  display: {
    name: "Baidu Qianfan",
    icon: "cloud",
    iconUrl: "/providers/qianfan.svg",
    color: "#2468F2",
    textIcon: "BD",
    website: "https://cloud.baidu.com/product/wenxinworkshop",
    notice: {
      text: "Use a Qianfan API key from Baidu AI Cloud. The default endpoint is OpenAI-compatible v2.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://qianfan.baidubce.com/v2/chat/completions",
    validateUrl: "https://qianfan.baidubce.com/v2/models",
  },
  models: [
    { id: "ernie-5.1", name: "ERNIE 5.1" },
    { id: "ernie-5.0-thinking-latest", name: "ERNIE 5.0 Thinking Latest" },
    { id: "ernie-x1.1", name: "ERNIE X1.1", contextLength: 64000 },
  ],
  modelsFetcher: { url: "https://qianfan.baidubce.com/v2/models", type: "openai" },
  defaultContextLength: 128000,
};
