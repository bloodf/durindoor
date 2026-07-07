export default {
  id: "galadriel",
  alias: "galadriel",
  display: {
    name: "Galadriel",
    icon: "auto_awesome",
    color: "#F59E0B",
    textIcon: "GA",
    website: "https://galadriel.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.galadriel.com/v1/verified/chat/completions",
    authHeader: "bearer",
    modelsUrl: "https://api.galadriel.com/v1/verified/models",
    // Galadriel's verified API currently rejects streaming chat requests.
    forceNonStreaming: true,
  },
  models: [
    { id: "galadriel-latest", name: "galadriel-latest" },
  ],
};
