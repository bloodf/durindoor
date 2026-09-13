// Playground domain: every public inference endpoint the dashboard calls
// (/v1/*, /api/v1/*, /v1beta/*) plus the translator debug API.
import registerChat from "./playground/chat.js";
import registerModels from "./playground/models.js";
import registerMedia from "./playground/media.js";
import registerTranslator from "./playground/translator.js";

export default function register(router, context) {
  registerChat(router, context);
  registerModels(router, context);
  registerMedia(router, context);
  registerTranslator(router, context);
}
