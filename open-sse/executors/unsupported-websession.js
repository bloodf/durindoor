import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { HuggingChatExecutor } from "./huggingchat.js";

// Guarded web sessions that stay closed unless the connection opts in. The opt-in is read from the
// connection's own providerSpecificData, so enabling one account never opens a sibling (#2034).
const SESSION_DISPATCH_OPT_IN = {
  huggingchat: () => new HuggingChatExecutor(),
};
const sessionDispatchExecutors = new Map();

export function isSessionDispatchEnabled(provider, credentials) {
  return Object.hasOwn(SESSION_DISPATCH_OPT_IN, provider) &&
    credentials?.providerSpecificData?.enableSessionDispatch === true;
}

export const BLOCKED_OMNIROUTE_PROVIDERS = {
  // OmniRoute #6894: Devin is a cloud-agent provider with transport:null — it
  // has no chat/completions upstream. Without this fail-closed entry,
  // getExecutor("devin") fell through to DefaultExecutor, whose constructor
  // substitutes PROVIDERS.openai when PROVIDERS["devin"] is undefined, which
  // sent the saved Devin API key as a Bearer token to api.openai.com
  // (cross-provider credential disclosure via direct model:"devin/devin"
  // dispatch). The 501 response performs ZERO upstream fetch.
  devin: {
    aliases: [],
    source: [
      "open-sse/providers/registry/devin.js",
    ],
    detail: "runtime execution is not available",
    reason: "cloud-agent provider (kind: agent) with no chat transport — credential/catalog only",
  },
  huggingchat: {
    aliases: [],
    source: [
      "open-sse/executors/huggingchat.ts",
      "open-sse/executors/huggingchat/jsonlStream.ts",
    ],
    reason: "requires HuggingChat cookie normalization, JSONL streaming, and SvelteKit conversation bootstrap",
  },
  "muse-spark-web": {
    aliases: ["ms-web"],
    source: [
      "open-sse/executors/muse-spark-web.js",
      "open-sse/executors/muse-spark-web/response-parser.js",
    ],
    reason: "requires Meta/Muse GraphQL request construction, continuation cache, and response parser",
  },
  suno: {
    aliases: [],
    source: [
      "open-sse/config/musicRegistry.ts",
      "open-sse/handlers/musicGeneration.ts",
      "src/app/api/v1/music/generations/route.ts",
    ],
    reason: "requires OmniRoute's music-generation route and Suno media executor contract",
  },
  udio: {
    aliases: [],
    source: [
      "open-sse/config/musicRegistry.ts",
      "open-sse/handlers/musicGeneration.ts",
      "src/app/api/v1/music/generations/route.ts",
    ],
    reason: "requires OmniRoute's music-generation route and Udio media executor contract",
  },
};

export const BLOCKED_OMNIROUTE_PROVIDER_ALIASES = Object.fromEntries(
  Object.entries(BLOCKED_OMNIROUTE_PROVIDERS)
    .flatMap(([provider, blocker]) => (blocker.aliases || []).map((alias) => [alias, provider])),
);

export class UnsupportedOmniRouteWebSessionExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || { baseUrl: "", noAuth: true });
    this.blocker = BLOCKED_OMNIROUTE_PROVIDERS[provider] || {
      source: [],
      reason: "requires an OmniRoute web-session executor not yet ported to this JS branch",
    };
    this.detail = BLOCKED_OMNIROUTE_PROVIDERS[provider]?.detail
      || "is registered from OmniRoute PR #51 but runtime execution is not ported yet";
    this.noAuth = true;
  }

  // Fail-closed beyond execute(): routes like translator/translate step 3 call
  // buildUrl/buildHeaders DIRECTLY on the resolved executor and return the
  // result to the caller without ever invoking execute(). BaseExecutor
  // .buildHeaders would attach the provider's saved credential as an
  // Authorization/x-api-key header (it ignores config.noAuth), disclosing the
  // blocked provider's token to the HTTP caller. A blocked provider has no
  // usable upstream, so it must never vend a URL or an authenticated header —
  // fail LOUD (throw) rather than return a sanitized-but-successful result;
  // the route's outer catch maps this to { success: false, error } with no
  // credential material.
  _unsupportedError() {
    return new Error(
      `${this.provider} ${this.detail}: ${this.blocker.reason}.`,
    );
  }

  buildUrl() {
    throw this._unsupportedError();
  }

  buildHeaders() {
    throw this._unsupportedError();
  }

  async execute(input) {
    if (isSessionDispatchEnabled(this.provider, input?.credentials)) {
      if (!sessionDispatchExecutors.has(this.provider)) sessionDispatchExecutors.set(this.provider, SESSION_DISPATCH_OPT_IN[this.provider]());
      return sessionDispatchExecutors.get(this.provider).execute(input);
    }
    const payload = {
      error: {
        message: `${this.provider} ${this.detail}: ${this.blocker.reason}.`,
        type: "provider_port_pending",
        provider: this.provider,
        sourceFiles: this.blocker.source,
      },
    };
    return {
      response: new Response(JSON.stringify(payload), {
        status: 501,
        headers: { "Content-Type": "application/json" },
      }),
      url: this.config?.baseUrl || "",
      headers: {},
      transformedBody: payload,
    };
  }

  parseError(response, bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed?.error?.type === "provider_port_pending") {
        return {
          status: response.status,
          message: parsed.error.message,
          errorBody: parsed,
        };
      }
    } catch {
      // fall through to default
    }
    return super.parseError(response, bodyText);
  }
}
