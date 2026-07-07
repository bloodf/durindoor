export default {
  id: "sensenova",
  alias: "sensenova",
  display: {
    name: "SenseNova",
    icon: "auto_awesome",
    iconUrl: "/providers/sensenova.svg",
    color: "#0066FF",
    textIcon: "SN",
    website: "https://platform.sensenova.cn",
    notice: {
      text: "SenseNova registration appears to require a Chinese (+86) phone number for SMS verification; international users may be unable to obtain an API key.",
      signupUrl: "https://platform.sensenova.cn/console",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.sensenova.cn/v1/chat/completions",
  },
  models: [
    { id: "SenseNova-V6.5-Pro", name: "SenseNova V6.5 Pro", contextLength: 131072 },
    { id: "SenseNova-V6.5-Turbo", name: "SenseNova V6.5 Turbo", contextLength: 131072 },
    { id: "sensenova-6.7-flash-lite", name: "SenseNova 6.7 Flash-Lite" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "SenseChat-5", name: "SenseChat 5", contextLength: 131072 },
    { id: "SenseChat-5-Cantonese", name: "SenseChat 5 Cantonese", contextLength: 32768 },
    { id: "SenseChat-Turbo", name: "SenseChat Turbo", contextLength: 4096 },
    { id: "SenseChat-Vision", name: "SenseChat Vision", contextLength: 4096 },
    { id: "SenseChat-Character", name: "SenseChat Character", contextLength: 8192 },
    { id: "sensechat", name: "SenseChat" },
  ],
  passthroughModels: true,
};
