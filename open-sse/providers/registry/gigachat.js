export default {
  id: "gigachat",
  alias: "gigachat",
  display: {
    name: "GigaChat",
    icon: "/providers/gigachat.png",
    color: "#22C55E",
    textIcon: "GC",
    website: "https://developers.sber.ru/portal/products/gigachat-api",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    tokenUrl: "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
    tokenScope: "GIGACHAT_API_PERS",
    authHeader: "bearer",
  },
  models: [
    { id: "GigaChat-2-Max", name: "GigaChat-2-Max" },
    { id: "GigaChat-2-Pro", name: "GigaChat-2-Pro" },
    { id: "GigaChat-2-Lite", name: "GigaChat-2-Lite" },
  ],
};
