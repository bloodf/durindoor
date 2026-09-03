export default {
  id: "bigmodel",
  alias: "bigmodel",
  display: {
    name: "BigModel",
    icon: "code",
    color: "#1D4ED8",
    textIcon: "BM",
    website: "https://open.bigmodel.cn",
    notice: {
      apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    // No standard /models list endpoint verified for this API; probe the
    // registry's chat endpoint directly instead of guessing a models route.
    probeUsesBaseUrl: true,
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  models: [
    { id: "glm-5.3", name: "GLM 5.3" },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
  ],
};
