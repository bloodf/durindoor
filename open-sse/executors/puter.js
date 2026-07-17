import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

/**
 * PuterExecutor targets Puter's OpenAI-compatible chat endpoint.
 * Puter accepts catalog model ids directly, so request bodies are forwarded
 * without model rewriting.
 */
export class PuterExecutor extends BaseExecutor {
  constructor() {
    super("puter", PROVIDERS.puter || { format: "openai" });
  }

  buildUrl() {
    return "https://api.puter.com/puterai/openai/v1/chat/completions";
  }

  buildHeaders(credentials = {}, stream = true) {
    const headers = {
      "Content-Type": "application/json",
    };
    const key = credentials.apiKey || credentials.accessToken;
    if (key) headers.Authorization = `Bearer ${key}`;
    if (stream) headers.Accept = "text/event-stream";
    return headers;
  }
}

export default PuterExecutor;
