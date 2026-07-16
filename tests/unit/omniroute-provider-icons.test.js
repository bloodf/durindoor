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
      // OmniRoute #6926 — 46 provider SVG icons
      "api-airforce.svg",
      "auggie.svg",
      "bluesminds.svg",
      "byteplus.svg",
      "bytez.svg",
      "charm-hyper.svg",
      "chipotle.svg",
      "chutes.svg",
      "crof.svg",
      "dgrid.svg",
      "digitalocean.svg",
      "dit.svg",
      "duckduckgo-web.svg",
      "factory.svg",
      "freeaiapikey.svg",
      "freemodel-dev.svg",
      "galadriel.svg",
      "gitlawb-gmi.svg",
      "gitlawb.svg",
      "hackclub.svg",
      "haiper.svg",
      "hcnsec.svg",
      "ideogram.svg",
      "kenari.svg",
      "leonardo.svg",
      "llm7.svg",
      "modelscope.svg",
      "nube.svg",
      "openadapter.svg",
      "orcarouter.svg",
      "pioneer.svg",
      "publicai.svg",
      "qiniu.svg",
      "requesty.svg",
      "sumopod.svg",
      "t3-web.svg",
      "theoldllm.svg",
      "tokenrouter.svg",
      "uncloseai.svg",
      "veoaifree-web.svg",
      "wafer.svg",
      "x5lab.svg",
      "yuanbao-web.svg",
      "zed-hosted.svg",
      "zenmux-free.svg",
      "zenmux.svg",
    ];

    for (const icon of expectedIcons) {
      expect(
        existsSync(resolve(repoRoot, "public/providers", icon)),
        `${icon} should be served from public/providers`,
      ).toBe(true);
    }
  });
});
