// Sarvam catalog truthfulness (#768). Unverified: authenticated /v1/models and chat routing.
import { describe, expect, it } from "vitest";
import sarvam from "../../open-sse/providers/registry/sarvam.js";

describe("sarvam registry catalog", () => {
  it("does not advertise sarvam-30b or unverified context lengths", () => {
    const ids = sarvam.models.map((m) => m.id);
    expect(ids).toEqual(["sarvam-105b", "sarvam-105b-conversations"]);
    expect(sarvam.models.some((m) => "contextLength" in m)).toBe(false);
  });

  it("derives the live catalog from /v1/models", () => {
    expect(sarvam.modelsFetcher).toEqual({ url: "https://api.sarvam.ai/v1/models", type: "openai" });
    expect(sarvam.passthroughModels).toBe(true);
  });
});
