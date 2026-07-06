import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");

describe("OmniRoute provider icon assets", () => {
  it("keeps copied provider icons local for future ports", () => {
    const expectedIcons = [
      "agentrouter.png",
      "aimlapi.png",
      "baichuan.svg",
      "baidu.svg",
      "command-code.svg",
      "claude-web.svg",
      "gitlab-duo.svg",
      "huggingchat.svg",
      "puter.svg",
      "sensenova.svg",
    ];

    for (const icon of expectedIcons) {
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should be served from public/providers`,
      ).toBe(true);
    }
  });
});
