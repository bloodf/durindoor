import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

export const BLOCKED_OMNIROUTE_PROVIDERS = {
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
