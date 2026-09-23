import { GithubExecutor } from "./github.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveGheCopilotApiBase } from "../config/gheCopilot.js";
import { refreshGheCopilotCredentials } from "../services/gheCopilotAuth.js";

const ENDPOINT_PATHS = {
  baseUrl: "/chat/completions",
  responsesUrl: "/responses",
  messagesUrl: "/v1/messages"
};

/**
 * GitHub Enterprise Copilot executor.
 *
 * Identical request handling to GithubExecutor (Claude via /v1/messages,
 * codex-class models via /responses, the rest via /chat/completions); only
 * the hosts differ. Each URL is derived from the connection's Copilot API
 * host (`copilotApiUrl`, from the token exchange), and token refresh runs
 * against the enterprise host in `gheUrl`.
 */
export class GheCopilotExecutor extends GithubExecutor {
  constructor() {
    super("ghe-copilot", PROVIDERS["ghe-copilot"]);
  }

  endpointUrl(kind, credentials = null) {
    const path = ENDPOINT_PATHS[kind];
    if (!path) return super.endpointUrl(kind, credentials);
    const base = resolveGheCopilotApiBase(credentials?.providerSpecificData);
    if (!base) {
      throw new Error("GitHub Enterprise Copilot connection is missing its enterprise URL; reconnect it");
    }
    return `${base}${path}`;
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshGheCopilotCredentials(credentials, log, proxyOptions);
  }
}

export default GheCopilotExecutor;
