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
    baseUrl: "https://api.galadriel.ai/v1/chat/completions",
    authHeader: "bearer",
  },
  models: [
    { id: "galadriel-latest", name: "galadriel-latest" },
  ],
};
