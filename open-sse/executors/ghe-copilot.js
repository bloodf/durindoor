import { GithubExecutor } from "./github.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveGheCopilotApiBase } from "../config/gheCopilot.js";
import { refreshGheCopilotCredentials } from "../services/gheCopilotAuth.js";

const ENDPOINT_PATHS = {
  baseUrl: "/chat/completions",
  responsesUrl: "/responses",
  messagesUrl: "/v1/messages"
};

/** Model ids may arrive prefixed with the provider alias. */
const PROVIDER_PREFIX = /^(?:ghe-copilot|ghe)\//;

function stripProviderPrefix(model) {
  return String(model || "").replace(PROVIDER_PREFIX, "");
}

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

  /**
   * Enterprise GPT-6 models use the existing enterprise /responses route.
   *
   * The enterprise catalog does not publish a per-model endpoint contract for
   * the GPT-6 family, so those models would stay on /chat/completions and
   * fail with Copilot's own "not accessible via the /chat/completions
   * endpoint" error. The enterprise route already serves /responses
   * (ENDPOINT_PATHS.responsesUrl), so the family uses it there — the same
   * route the codex models already reach through the provider's own error.
   *
   * A discovered contract still wins: when the account's catalog states the
   * route for a model, that statement is used instead of the family rule.
   * Models Copilot's Responses endpoint does not serve (Claude, Gemini) are
   * excluded either way.
   */
  copilotEndpointRoute(model, credentials) {
    const stated = super.copilotEndpointRoute(model, credentials);
    if (stated) return stated;
    const bare = stripProviderPrefix(model);
    if (!/^gpt-6/i.test(bare)) return null;
    if (!this.supportsResponsesEndpoint(bare)) return null;
    return "responses";
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshGheCopilotCredentials(credentials, log, proxyOptions);
  }
}

export default GheCopilotExecutor;
