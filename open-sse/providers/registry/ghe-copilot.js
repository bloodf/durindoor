import github from "./github.js";

// GitHub Enterprise Copilot. Same wire protocol and model catalog as `github`,
// but every host comes from the connection: the GHE web host the user typed
// (providerSpecificData.gheUrl) for OAuth, and the Copilot API host returned by
// the token exchange (copilotApiUrl) for chat. The transport URLs below are
// static placeholders; GheCopilotExecutor resolves the real ones per request.
export default {
  id: "ghe-copilot",
  priority: 41,
  alias: "ghe",
  uiAlias: "ghe",
  display: {
    name: "GitHub Enterprise Copilot",
    icon: "code",
    color: "#10B981",
    website: "https://docs.github.com/en/enterprise-cloud@latest/copilot",
    notice: {
      text: "Enter your GitHub Enterprise URL (for example https://ghe.company.com), then sign in with the device code.",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: github.transport.baseUrl,
    responsesUrl: github.transport.responsesUrl,
    messagesUrl: github.transport.messagesUrl,
    headers: github.transport.headers,
    copilot: github.transport.copilot,
    quirks: github.transport.quirks,
  },
  models: github.models.filter((model) => model.kind !== "embedding"),
  serviceKinds: ["llm"],
  oauth: {
    // GitHub's Copilot OAuth app. Self-hosted GHES instances that do not carry
    // it can override with GHE_COPILOT_OAUTH_CLIENT_ID.
    clientId: github.oauth.clientId,
    scopes: github.oauth.scopes,
    apiVersion: github.oauth.apiVersion,
    userAgent: github.oauth.userAgent,
  },
};
