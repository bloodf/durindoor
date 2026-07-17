export default {
  id: "codex-cloud",
  priority: 901,
  alias: "codex-cloud",
  display: {
    name: "Codex Cloud",
    icon: "cloud",
    color: "#10A37F",
    textIcon: "CC",
    website: "https://openai.com/codex",
    notice: {
      text: "Cloud-agent credential metadata only; task execution is handled by the cloud-agent subsystem.",
    },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "OpenAI API key with Codex Cloud task access.",
  transport: null,
  models: [],
  hidden: true,
};
