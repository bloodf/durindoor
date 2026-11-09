// Sarvam catalog truthfulness (#768). Unverified: authenticated /v1/models and chat routing.
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../src/app/api/providers/suggested-models/route.js";
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

describe("sarvam live catalog resolver (stubbed fetch, no network)", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  // Shape of the anonymous /v1/models response seen on 2026-11-04 and recorded in the #768 audit.
  const fixture = {
    object: "list",
    data: [
      { id: "sarvam-105b", object: "model", created: 0, owned_by: "sarvam" },
      { id: "sarvam-105b-conversations", object: "model", created: 0, owned_by: "sarvam" },
    ],
  };

  it("resolves exactly the two documented ids through the registered fetcher and never sarvam-30b", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(fixture), { status: 200 }));
    const url = new URL("http://localhost/api/providers/suggested-models");
    url.searchParams.set("url", sarvam.modelsFetcher.url);
    url.searchParams.set("type", sarvam.modelsFetcher.type);

    const response = await GET(new Request(url));
    const { data } = await response.json();

    expect(global.fetch).toHaveBeenCalledWith(sarvam.modelsFetcher.url, { redirect: "error" });
    expect(data.map((m) => m.id)).toEqual(["sarvam-105b", "sarvam-105b-conversations"]);
    expect(data.some((m) => m.id === "sarvam-30b")).toBe(false);
  });
});
