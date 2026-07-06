import { describe, expect, it } from "vitest";
import { getExecutor, hasSpecializedExecutor } from "open-sse/executors/index.js";
import {
  BLOCKED_OMNIROUTE_PROVIDERS,
  UnsupportedOmniRouteWebSessionExecutor,
} from "open-sse/executors/unsupported-websession.js";

const RUNTIME_PORTED_WEB_SESSION_PROVIDERS = [
  "adapta-web",
  "chatgpt-web",
  "copilot-m365-web",
  "copilot-web",
  "duckduckgo-web",
  "huggingchat",
  "muse-spark-web",
  "t3-web",
  "veoaifree-web",
  "yuanbao-web",
];

const RUNTIME_PORTED_WEB_SESSION_ALIASES = [
  "adp-web",
  "cgpt-web",
  "ddgw",
  "m365copilot",
  "ms-web",
  "t3chat",
  "veo-free",
  "ybw",
];

describe("OmniRoute web-session integration stack", () => {
  it("maps every runtime-ported web-session provider and alias to a concrete executor", () => {
    for (const provider of [
      ...RUNTIME_PORTED_WEB_SESSION_PROVIDERS,
      ...RUNTIME_PORTED_WEB_SESSION_ALIASES,
    ]) {
      expect(hasSpecializedExecutor(provider), `${provider} specialized executor`).toBe(true);
      expect(getExecutor(provider), `${provider} concrete executor`).not.toBeInstanceOf(
        UnsupportedOmniRouteWebSessionExecutor,
      );
    }
  });

  it("keeps only truly pending web-session providers in the blocker list", () => {
    expect(Object.keys(BLOCKED_OMNIROUTE_PROVIDERS).sort()).toEqual(["suno", "udio"]);
  });
});
