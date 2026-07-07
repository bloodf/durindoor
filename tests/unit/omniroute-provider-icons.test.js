import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("OmniRoute provider icon assets", () => {
  it("keeps copied provider icons local for future ports", () => {
    const expectedIcons = [
      "agentrouter.png",
      "aimlapi.png",
      "baichuan.svg",
      "baidu.svg",
      "bazaarlink.svg",
      "command-code.svg",
      "claude-web.svg",
      "docker-model-runner.svg",
      "coze.svg",
      "gitlab-duo.svg",
      "huggingchat.svg",
      "lemonade.png",
      "llamafile.png",
      "opencode.svg",
      "opencode-dark.svg",
      "opencode-light.svg",
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
