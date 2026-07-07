export default {
  id: "yi",
  alias: "yi",
  display: {
    name: "Yi (01.AI)",
    icon: "auto_awesome",
    iconUrl: "/providers/yi.svg",
    color: "#10B981",
    textIcon: "YI",
    website: "https://01.ai",
    notice: {
      text: "No free API tier in 2026; platform.01.ai is pay-as-you-go and open weights are download-only.",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://api.lingyiwanwu.com/v1/chat/completions",
  },
  models: [
    { id: "yi-large", name: "Yi Large" },
  ],
  passthroughModels: true,
};
