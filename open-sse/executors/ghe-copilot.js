import { GithubExecutor } from "./github.js";
import { PROVIDERS } from "../config/providers.js";
import { resolveGheCopilotApiBase } from "../config/gheCopilot.js";
import {
  refreshBoundGheCopilotCredentials,
  gheRequestContext,
  gheBoundFetch,
  GheConnectionError,
  resolveBoundGheApiBase
} from "../../src/lib/oauth/providerParity/copilot/gheConnection.js";

const ENDPOINT_PATHS = {
  baseUrl: "/chat/completions",
  responsesUrl: "/responses",
  messagesUrl: "/v1/messages"
};

/** Model ids may arrive prefixed with the provider alias. */
const PROVIDER_PREFIX = /^(?:ghe-copilot|ghe)\//;

/** Neither an enterprise issuer nor a sign-in binding is stored. */
function isUnboundLegacyRow(credentials) {
  const psd = credentials?.providerSpecificData || {};
  return !psd.gheUrl && !psd.gheBinding;
}

function stripProviderPrefix(model) {
  return String(model || "").replace(PROVIDER_PREFIX, "");
}

/**
 * GitHub Enterprise Copilot executor.
 *
 * Identical request handling to GithubExecutor (Claude via /v1/messages,
 * codex-class models via /responses, the rest via /chat/completions); only
 * the hosts differ. Each URL is derived from the connection's Copilot API
 * host (`copilotApiUrl`, from the token exchange) when the connection trusts
 * it, and token refresh runs against the enterprise host in `gheUrl` with the
 * connection's proxy and no redirects (#2034 connection binding).
 */
export class GheCopilotExecutor extends GithubExecutor {
  constructor() {
    super("ghe-copilot", PROVIDERS["ghe-copilot"]);
  }

  endpointUrl(kind, credentials = null) {
    const path = ENDPOINT_PATHS[kind];
    if (!path) return super.endpointUrl(kind, credentials);
    const psd = credentials?.providerSpecificData;
    // A stored enterprise host binds the API host to it. Rows without one (not
    // produced by the current sign-in) keep the previous resolution.
    const base = psd?.gheUrl ? resolveBoundGheApiBase(psd) : resolveGheCopilotApiBase(psd);
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

  async execute(options) {
    options.signal?.throwIfAborted();
    // Rows with neither an issuer nor a binding predate enterprise binding and
    // carry only an operator-stored API URL; they keep the prior dispatch.
    if (isUnboundLegacyRow(options.credentials)) return super.execute(options);
    const context = gheRequestContext(options.credentials, options.proxyOptions || null);
    if (options.credentials.providerSpecificData.aiCreditLimit != null) {
      throw new GheConnectionError("unsupported_ghe_usage", "Enterprise AI Credits lookup is unsupported by the pinned GHE source; refusing consumer GitHub usage routing");
    }
    // The validated API is copied into this request, never shared executor state.
    const credentials = { ...options.credentials, copilotToken: context.token,
      providerSpecificData: { ...options.credentials.providerSpecificData, copilotApiUrl: context.base } };
    return super.execute({ ...options, credentials, proxyOptions: context.binding.proxyOptions, directFetch: null });
  }

  isTerminalRequestError(error) {
    return error instanceof GheConnectionError || error?.name === "OutboundUrlGuardError";
  }

  boundRequestTransport(url, proxyOptions, credentials) {
    if (isUnboundLegacyRow(credentials)) return null;
    return (init) => this.fetchProviderRequest(url, init, proxyOptions, credentials);
  }

  fetchProviderRequest(url, init, proxyOptions, credentials) {
    if (isUnboundLegacyRow(credentials)) return super.fetchProviderRequest(url, init, proxyOptions, credentials);
    const context = gheRequestContext(credentials, proxyOptions);
    if (new URL(url).origin !== new URL(context.base).origin) throw new Error("GitHub Enterprise API origin changed during dispatch");
    return gheBoundFetch(context.binding, url, init);
  }

  buildHeaders(credentials, stream = true, requestContext = null) {
    if (isUnboundLegacyRow(credentials)) return super.buildHeaders(credentials, stream, requestContext);
    const token = credentials?.copilotToken || credentials?.providerSpecificData?.copilotToken;
    if (!token) throw new Error("GitHub Enterprise reauthentication needed: session credential is missing");
    return super.buildHeaders({ ...credentials, accessToken: undefined, copilotToken: token }, stream, requestContext);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    return refreshBoundGheCopilotCredentials(credentials, log, proxyOptions);
  }
}

export default GheCopilotExecutor;
