import codex from "./codex.js";

// Text models only: the app-server turn API has no image or transcription surface.
const textModels = codex.models.filter((model) => !model.kind);

export default {
  id: "codex-app-server",
  priority: 60,
  alias: "cxa",
  uiAlias: "cxa",
  display: {
    name: "OpenAI Codex (App-Server, unverified)",
    icon: "code",
    color: "#3B82F6",
    textIcon: "CA",
    website: "https://learn.chatgpt.com/docs/app-server",
    notice: {
      text: "Unverified and experimental. Drives a local codex app-server over its WebSocket transport, which OpenAI documents as experimental and unsupported, and re-serves that CLI's ChatGPT subscription through this gateway. Set DURINDOOR_CODEX_APPSERVER_WS and a capability token; see the provider docs.",
    },
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "codex-app-server://cli/websocket",
    format: "openai",
    forceStream: true,
    noAuth: true,
  },
  models: textModels,
};
