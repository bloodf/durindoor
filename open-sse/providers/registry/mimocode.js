export default {
  id: "mimocode",
  priority: 46,
  hasFree: true,
  alias: "mcode",
  uiAlias: "mcode",
  display: {
    name: "MiMoCode",
    icon: "smart_toy",
    color: "#FF6900",
    textIcon: "MC",
    website: "https://github.com/XiaomiMiMo/MiMo-Code",
    notice: {
      text: "Free Xiaomi MiMoCode endpoint using fingerprint bootstrap JWTs. Store providerSpecificData.fingerprints and HTTP/HTTPS accountProxies on the no-auth connection to enable multi-account rotation; account proxies override the connection proxy pool for matching fingerprints.",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://api.xiaomimimo.com",
    chatPath: "/api/free-ai/openai/chat",
    format: "openai",
    noAuth: true,
  },
  models: [
    { id: "mimo-auto", name: "MiMo Auto", contextLength: 1000000 },
  ],
  passthroughModels: true,
};
