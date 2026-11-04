// Sarvam catalog truthfulness (#768). Unverified: authenticated /v1/models and chat routing.
import { describe, expect, it } from "vitest";
import sarvam from "../../open-sse/providers/registry/sarvam.js";

describe("sarvam registry catalog", () => {
  it("advertises only the two models Sarvam documents, with the documented context sizes", () => {
    expect(sarvam.models.map((m) => [m.id, m.contextLength])).toEqual([
      ["sarvam-105b", 128000],
      ["sarvam-105b-conversations", 32000],
    ]);
    expect(sarvam.models.some((m) => m.id === "sarvam-30b")).toBe(false);
  });

  it("states the documented free-credit amount, not the retired one", () => {
    expect(sarvam.display.notice.text).toContain("₹100");
    expect(sarvam.display.notice.text).not.toContain("1,000");
  });

  it("derives the live catalog from /v1/models", () => {
    expect(sarvam.modelsFetcher).toEqual({ url: "https://api.sarvam.ai/v1/models", type: "openai" });
    expect(sarvam.passthroughModels).toBe(true);
  });
});
