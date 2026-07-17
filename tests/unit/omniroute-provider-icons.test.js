import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const ADDED_SVG_IDS = [
  "api-airforce",
  "auggie",
  "bluesminds",
  "byteplus",
  "bytez",
  "charm-hyper",
  "chipotle",
  "chutes",
  "crof",
  "dgrid",
  "digitalocean",
  "dit",
  "duckduckgo-web",
  "factory",
  "freeaiapikey",
  "freemodel-dev",
  "galadriel",
  "gitlawb",
  "hackclub",
  "haiper",
  "hcnsec",
  "ideogram",
  "kenari",
  "leonardo",
  "llm7",
  "modelscope",
  "nube",
  "openadapter",
  "orcarouter",
  "pioneer",
  "publicai",
  "qiniu",
  "requesty",
  "sumopod",
  "t3-web",
  "theoldllm",
  "tokenrouter",
  "uncloseai",
  "veoaifree-web",
  "wafer",
  "x5lab",
  "yuanbao-web",
  "zed-hosted",
  "zenmux",
  "zenmux-free",
];

// These copied SVGs intentionally have no registry entry (and therefore no UI
// consumer), so they are stored for future ports but are not wired yet.
const EXCLUDED_UNWIRED = [
  "modelscope",
  "openadapter",
  "orcarouter",
  "pioneer",
  "publicai",
  "zed-hosted",
];

function readKnownSvgs() {
  const source = readFileSync(
    resolve(repoRoot, "src/shared/components/ProviderIcon.js"),
    "utf8",
  );
  const match = source.match(/const\s+KNOWN_SVGS\s*=\s*new\s+Set\(\[([^\]]*)\]/s);
  return new Set(
    match[1]
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean),
  );
}

function readRegistryIds() {
  const regDir = resolve(repoRoot, "open-sse/providers/registry");
  return new Set(
    readdirSync(regDir)
      .filter((f) => f.endsWith(".js"))
      .map((f) => basename(f, ".js")),
  );
}

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
      // OmniRoute #6926 — 45 provider SVG icons (46 listed historically because
      // gitlawb-gmi.svg was already on dev before this PR).
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

  it("wires every added SVG through ProviderIcon or marks it intentionally excluded", () => {
    expect(ADDED_SVG_IDS).toHaveLength(45);

    const knownSvgs = readKnownSvgs();
    const registryIds = readRegistryIds();
    const svgFiles = readdirSync(resolve(repoRoot, "public/providers")).filter((f) =>
      f.endsWith(".svg"),
    );
    const unregistered = [];

    for (const id of ADDED_SVG_IDS) {
      expect(svgFiles).toContain(`${id}.svg`);
      if (registryIds.has(id)) {
        expect(knownSvgs.has(id), `${id} has a registry entry and must be in KNOWN_SVGS`).toBe(true);
      } else {
        expect(EXCLUDED_UNWIRED).toContain(id);
        expect(knownSvgs.has(id), `${id} is excluded and must not be in KNOWN_SVGS`).toBe(false);
        unregistered.push(id);
      }
    }

    expect(new Set(unregistered)).toEqual(new Set(EXCLUDED_UNWIRED));
  });

  it("routes the provider detail header through ProviderIcon", () => {
    const detailPage = readFileSync(
      resolve(repoRoot, "src/app/(dashboard)/dashboard/providers/[id]/page.js"),
      "utf8",
    );
    expect(detailPage).toContain("ProviderIcon");
    expect(detailPage).not.toMatch(/import\s+Image\s+from\s+["']next\/image["']/);
    expect(detailPage).toContain("src={providerInfo.iconUrl || getHeaderIconPath()}");
  });
});
