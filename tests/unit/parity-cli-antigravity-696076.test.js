import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "@/lib/oauth/providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("Antigravity bounded project responses", () => {
  it.each(["loadCodeAssist", "onboardUser"])("rejects an oversized %s response", async (oversized) => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("userinfo")) return Response.json({ email: "test@example.test" });
      if (url.includes(oversized)) return new Response(JSON.stringify({ padding: "x".repeat(1024 * 1024) }));
      if (url.includes("loadCodeAssist")) return Response.json({});
      throw new Error(`Unexpected outbound URL: ${url}`);
    }));

    await expect(getProvider("antigravity").postExchange({ access_token: "synthetic" }, null)).rejects.toThrow();
    expect(calls.some((url) => url.includes(oversized))).toBe(true);
  });
});
