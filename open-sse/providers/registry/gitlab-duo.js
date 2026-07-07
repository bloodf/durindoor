export default {
  id: "gitlab-duo",
  priority: 100,
  display: {
    name: "GitLab Duo",
    icon: "code",
    color: "#FC6D26",
    textIcon: "GL",
    website: "https://gitlab.com",
    notice: {
      signupUrl: "https://gitlab.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://gitlab.com/api/v4/code_suggestions/completions",
    format: "openai",
    defaultContextLength: 200000,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    defaultBaseUrl: "https://gitlab.com",
    authorizeUrlPath: "/oauth/authorize",
    tokenUrlPath: "/oauth/token",
    userInfoUrlPath: "/api/v4/user",
    scope: "api read_user",
    codeChallengeMethod: "S256",
    clientId: process.env.GITLAB_DUO_OAUTH_CLIENT_ID || process.env.GITLAB_OAUTH_CLIENT_ID || "",
    clientSecret:
      process.env.GITLAB_DUO_OAUTH_CLIENT_SECRET || process.env.GITLAB_OAUTH_CLIENT_SECRET || "",
    refreshLeadMs: 5 * 60 * 1000,
  },
  models: [
    {
      id: "gitlab-duo-code-suggestions",
      name: "GitLab Duo Code Suggestions",
      contextLength: 200000,
    },
  ],
};
