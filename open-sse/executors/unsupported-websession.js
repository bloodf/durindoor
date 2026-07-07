import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export const BLOCKED_OMNIROUTE_PROVIDERS = {
  "adapta-web": {
    aliases: ["adp-web"],
    source: [
      "open-sse/executors/adapta-web.ts",
      "tests/unit/provider-validation-specialty.test.ts",
    ],
    reason: "requires the Adapta web-session bearer-token executor and credential validation flow",
  },
  "chatgpt-web": {
    aliases: ["cgpt-web"],
    source: [
      "open-sse/executors/chatgpt-web.ts",
      "open-sse/services/chatgptTlsClient.ts",
      "open-sse/services/chatgptImageCache.ts",
      "src/app/api/v1/images/edits/route.ts",
    ],
    reason: "requires the ChatGPT web TLS client, proof-of-work helpers, image cache route, and cookie normalization",
  },
  "duckduckgo-web": {
    aliases: ["ddgw"],
    source: [
      "open-sse/executors/duckduckgo-web.ts",
      "open-sse/executors/duckduckgo-web/challenge.ts",
      "open-sse/services/browserBackedChat.ts",
      "open-sse/services/sessionPool/*",
    ],
    reason: "requires the DuckDuckGo anti-abuse challenge solver and optional browser-backed session pool",
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
      "open-sse/executors/muse-spark-web.ts",
      "open-sse/executors/muse-spark-web/response-parser.ts",
      "tests/unit/muse-spark-web-continuation.test.ts",
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
  "t3-web": {
    aliases: ["t3chat"],
    source: [
      "open-sse/executors/t3-chat-web.ts",
      "tests/unit/provider-validation-specialty.test.ts",
    ],
    reason: "requires the T3 web-session executor, convex session id, and cookie validation flow",
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
  "veoaifree-web": {
    aliases: ["veo-free"],
    source: [
      "open-sse/executors/veoaifree-web.ts",
      "open-sse/config/videoRegistry.ts",
      "open-sse/handlers/videoGeneration.ts",
    ],
    reason: "requires WordPress AJAX video/image workflow plumbing and video-generation routes",
  },
  "yuanbao-web": {
    aliases: ["ybw"],
    source: [
      "open-sse/executors/yuanbao-web.ts",
      "tests/unit/provider-validation-specialty.test.ts",
    ],
    reason: "requires Tencent Yuanbao cookie-session SSE executor and validation flow",
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
    this.noAuth = true;
  }

  async execute() {
    const payload = {
      error: {
        message: `${this.provider} is registered from OmniRoute PR #51 but runtime execution is not ported yet: ${this.blocker.reason}.`,
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
