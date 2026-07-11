import { DefaultExecutor } from "./default.js";
import { resolveOllamaLocalHost } from "../config/providers.js";

export class OllamaLocalExecutor extends DefaultExecutor {
  constructor() {
    super("ollama-local");
  }

  // Runtime transport-aware URL selection.
  // When the resolved transport is the Claude-native /v1/messages path, substitute
  // the configured local Ollama host while preserving the path/query/suffix from the
  // registry transport. Falls back to the Ollama OpenAI-compatible /api/chat endpoint.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      // Preserve path + query + urlSuffix (parent contract), substitute the local host.
      // try/catch: malformed/relative/empty baseUrl falls back to verbatim like the parent
      // (default.js:122 uses rt.baseUrl as-is, never parses). WR-01/02/03.
      let url = rt.baseUrl;
      try {
        const u = new URL(rt.baseUrl);
        const configured = new URL(resolveOllamaLocalHost(credentials));
        // Stored local values may be origins or complete Ollama endpoints.
        // Runtime transport owns the endpoint path, so retain only the configured origin.
        url = configured.origin + u.pathname + u.search;
      } catch {
        url = rt.baseUrl;
      }
      if (rt.urlSuffix) url += rt.urlSuffix;
      return url;
    }
    return `${resolveOllamaLocalHost(credentials)}/api/chat`;
  }
}

export default OllamaLocalExecutor;
