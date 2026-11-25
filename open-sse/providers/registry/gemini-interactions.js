import { FORMATS } from "../../translator/formats.js";

export const GEMINI_INTERACTIONS_ID = "gemini-interactions";
export const GEMINI_MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  id: GEMINI_INTERACTIONS_ID,
  alias: GEMINI_INTERACTIONS_ID,
  display: {
    name: "Gemini Interactions",
    icon: "diamond",
    color: "#4285F4",
    textIcon: "GI",
    website: "https://aistudio.google.com/docs/interactions-overview",
    notice: { apiKeyUrl: "https://aistudio.google.com/app/apikey" },
  },
  category: "apikey",
  transport: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/interactions",
    validateUrl: GEMINI_MODELS_URL,
    format: FORMATS.OPENAI,
    // A provider error must never cause a retry with storage enabled.
    quirks: { allowFieldStripping: false, validationChatFallback: false },
    auth: { combined: true, header: "x-goog-api-key", scheme: "raw" },
  },
  models: [
    { id: "gemini-4-hydrogen", name: "Gemini 4 Hydrogen" },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
};
