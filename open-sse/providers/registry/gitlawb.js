export default {
  id: "gitlawb",
  alias: "glb",
  display: {
    name: "Gitlawb",
    icon: "code_blocks",
    color: "#F97316",
    textIcon: "GL",
    website: "https://github.com/Gitlawb/openclaude",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://opengateway.gitlawb.com/v1/xiaomi-mimo",
    authHeader: "bearer",
    headers: {
      "User-Agent": "OpenClaude/1.0 (linux; x86_64)",
      "X-Title": "OpenClaude CLI",
      "HTTP-Referer": "https://github.com/Gitlawb/openclaude",
    },
  },
  models: [
    { id: "mimo-v2.5-pro", name: "MiMo-V2.5-Pro", contextLength: 1048576, maxOutputTokens: 131072 },
    { id: "mimo-v2.5", name: "MiMo-V2.5", contextLength: 1048576, maxOutputTokens: 131072 },
    { id: "mimo-v2-pro", name: "MiMo-V2-Pro", contextLength: 262144, maxOutputTokens: 131072 },
    { id: "mimo-v2-omni", name: "MiMo-V2-Omni", contextLength: 262144, maxOutputTokens: 131072 },
    { id: "mimo-v2-flash", name: "MiMo-V2-Flash", contextLength: 262144, maxOutputTokens: 65536 },
  ],
};
