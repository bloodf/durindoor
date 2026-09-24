export default {
  id: "internlm",
  alias: "internlm",
  display: {
    name: "InternLM (Intern-S1)",
    icon: "auto_awesome",
    color: "#4F46E5",
    textIcon: "IL",
    website: "https://internlm.intern-ai.org.cn/",
    notice: {
      text: "Free monthly quota ~1M input / 3M output tokens (~10 RPM).",
      apiKeyUrl: "https://internlm.intern-ai.org.cn/",
    },
  },
  category: "apikey",
  authType: "apikey",
  hasFree: true,
  transport: {
    baseUrl: "https://chat.intern-ai.org.cn/api/v1/chat/completions",
    format: "openai",
  },
  models: [
    { id: "intern-s1-pro", name: "Intern-S1 Pro" },
    { id: "intern-s1", name: "Intern-S1" },
    { id: "intern-s1-mini", name: "Intern-S1 Mini" },
    { id: "internvl3.5-latest", name: "InternVL3.5 Latest" },
    { id: "intern-latest", name: "Intern Latest" },
  ],
  serviceKinds: ["llm"],
};
