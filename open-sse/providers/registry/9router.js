export default {
  id: "9router",
  priority: 65,
  alias: "nr",
  uiAlias: "nr",
  display: {
    name: "9router",
    icon: "router",
    color: "#0EA5E9",
    textIcon: "9R",
    website: "https://www.npmjs.com/package/9router",
    notice: {
      text: "Embedded/local 9router service. Configure the local base URL if it is not listening on 127.0.0.1:20130.",
    },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Local 9router API key. The managed service normally uses its own generated key.",
  transport: {
    baseUrl: "http://127.0.0.1:20130/v1",
    format: "openai",
  },
  models: [
    { id: "auto", name: "9router Auto" },
  ],
  passthroughModels: true,
};
