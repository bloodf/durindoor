export default {
  id: "vertex",
  priority: 40,
  alias: "vertex",
  aliases: [
    "vx",
  ],
  uiAlias: "vx",
  display: {
    name: "Vertex AI",
    icon: "cloud",
    color: "#4285F4",
    textIcon: "VX",
    website: "https://cloud.google.com/vertex-ai",
    notice: {
      text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.",
      apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts",
    },
  },
  category: "freeTier",
  transport: {
    baseUrl: "https://aiplatform.googleapis.com",
    format: "vertex",
  },
  models: [
    // Argon is served from global/us/eu (plus europe-west2 and asia-southeast1),
    // not us-central1 (Google Gemini 4 Argon model page, checked 2026-11-02;
    // upstream 9router 29fc880e). defaultLocation keeps connections without a
    // configured location off us-central1.
    { id: "gemini-4-argon", name: "Gemini 4 Argon", defaultLocation: "global" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  serviceKinds: ["llm","imageToText"],
};
