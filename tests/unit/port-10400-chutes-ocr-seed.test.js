import { describe, expect, it } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDER_MODELS } from "../../open-sse/providers/index.js";

// Upstream OmniRoute PR #10400 — derive imageToText from OCR registry +
// seed chutes dots.ocr via serviceKinds. DurinDoor has no OCR_PROVIDERS
// derivation surface, so we apply the data side: chutes advertises both
// `llm` and `imageToText` (see upstream gateways.ts comment re #10275 —
// declaring serviceKinds means `llm` must be explicit too).
// dots.ocr (rednote-hilab/dots.ocr) is served via Chutes discovery, so
// no static model entry is needed (passthroughModels).

describe("port 10400 — chutes imageToText seed", () => {
  const chutes = REGISTRY.find((e) => e.id === "chutes");

  it("registers chutes with llm + imageToText serviceKinds", () => {
    expect(chutes).toBeDefined();
    expect(chutes.serviceKinds).toEqual(["llm", "imageToText"]);
  });

  it("keeps chutes transport metadata intact", () => {
    expect(chutes.transport.baseUrl).toBe("https://llm.chutes.ai/v1/chat/completions");
    expect(chutes.transport.validateUrl).toBe("https://llm.chutes.ai/v1/models");
  });

  it("does not synthesize a static dots.ocr row (passthrough discovery only)", () => {
    const chutesModels = Object.entries(PROVIDER_MODELS).filter(
      ([, m]) => m.provider === "chutes",
    );
    const ids = chutesModels.map(([id]) => id);
    expect(ids).not.toContain("rednote-hilab/dots.ocr");
  });
});
