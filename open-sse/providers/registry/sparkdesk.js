export default {
  id: "sparkdesk",
  alias: "sparkdesk",
  display: {
    name: "SparkDesk",
    icon: "auto_awesome",
    iconUrl: "/providers/sparkdesk.svg",
    color: "#0066FF",
    textIcon: "SD",
    website: "https://xinghuo.xfyun.cn",
    notice: {
      text: "Spark Lite is free via iFlytek, but terms restrict personal/non-commercial use and prohibit relaying access to third parties.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://spark-api.xf-yun.com/v3.1/chat/completions",
  },
  models: [
    { id: "4.0Ultra", name: "Spark 4.0 Ultra", contextLength: 32768 },
    { id: "generalv3", name: "Spark Pro", contextLength: 8192 },
    { id: "pro-128k", name: "Spark Pro 128K", contextLength: 131072 },
    { id: "general", name: "General" },
  ],
  passthroughModels: true,
};
