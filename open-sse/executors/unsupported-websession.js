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
  "copilot-m365-web": {
    aliases: ["m365copilot"],
    source: [
      "open-sse/executors/copilot-m365-web.ts",
      "open-sse/executors/copilot-m365-connection.ts",
      "open-sse/executors/copilot-m365-frames.ts",
    ],
    reason: "requires Microsoft 365 BizChat WebSocket connection and frame helpers",
  },
  "copilot-web": {
    aliases: [],
    source: [
      "open-sse/executors/copilot-web.ts",
      "tests/unit/copilot-web-executor.test.ts",
    ],
    reason: "requires the Copilot web-session executor and browser-derived access-token flow",
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
}
