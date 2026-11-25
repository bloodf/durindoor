// Adapted from OmniRoute b748429cf5b3aeb142a708fd3e8751b6918b9dc8,
// open-sse/config/providers/registry/chatgpt/index.ts. Enrollment and dispatch
// are owner-operated and guarded separately from the generic OAuth routes.
export default {
  id: "chatgpt-plan",
  alias: "chatgpt-plan",
  display: {
    name: "ChatGPT Plan (owner-operated)",
    icon: "account_circle",
    color: "#475569",
    textIcon: "CP",
    website: "https://chatgpt.com",
  },
  category: "oauth",
  authType: "oauth",
  hidden: true,
  transport: { format: "openai-responses", executor: "chatgpt-plan" },
  models: [],
  serviceKinds: ["llm"],
};
