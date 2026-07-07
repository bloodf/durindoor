export default {
  id: "tencent",
  alias: "tencent",
  display: {
    name: "Tencent Hunyuan",
    icon: "auto_awesome",
    iconUrl: "/providers/tencent.svg",
    color: "#07C160",
    textIcon: "TC",
    website: "https://hunyuan.tencent.com",
    notice: {
      text: "Free Hunyuan Lite models in the WeChat ecosystem.",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1/chat/completions",
  },
  models: [
    { id: "hunyuan-turbos-latest", name: "Hunyuan TurboS Latest", contextLength: 200000 },
    { id: "hunyuan-t1-latest", name: "Hunyuan T1 Latest", contextLength: 256000 },
    { id: "hunyuan-pro", name: "Hunyuan Pro" },
    { id: "hunyuan-vision", name: "Hunyuan Vision" },
    { id: "hunyuan-functioncall", name: "Hunyuan FunctionCall" },
    { id: "hunyuan-lite", name: "Hunyuan Lite" },
  ],
  passthroughModels: true,
};
