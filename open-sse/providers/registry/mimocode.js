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
      text: "Free Xiaomi MiMoCode endpoint using fingerprint bootstrap JWTs. Optional providerSpecificData.fingerprints and HTTP/HTTPS accountProxies enable multi-account rotation.",
    },
  },
  category: "free",
  noAuth: true,
  autoComboNoAuth: true,
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
