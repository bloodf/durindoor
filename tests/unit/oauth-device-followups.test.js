import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "../../src/lib/oauth/providers.js";

afterEach(() => vi.unstubAllGlobals());

describe("device authorization follow-ups", () => {
  it("classifies malformed Kiro poll bodies without reading the stream twice", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not JSON", { status: 502 })));
    const kiro = getProvider("kiro");
    await expect(kiro.pollToken(kiro.config, "device", null, {})).resolves.toEqual({
      ok: false, data: { error: "invalid_response", error_description: "not JSON" },
    });
  });

  it("preserves valid Kiro polling responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 })));
    const kiro = getProvider("kiro");
    await expect(kiro.pollToken(kiro.config, "device", null, {})).resolves.toEqual({
      ok: false, data: { error: "authorization_pending", error_description: undefined },
    });
  });

  it("reads json-only Kiro responses once and classifies failures", async () => {
    const json = vi.fn().mockRejectedValue(new SyntaxError("invalid JSON"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json }));
    const kiro = getProvider("kiro");
    await expect(kiro.pollToken(kiro.config, "device", null, {})).resolves.toEqual({
      ok: false, data: { error: "invalid_response", error_description: undefined },
    });
    expect(json).toHaveBeenCalledOnce();
  });

  describe.each(["kimi-coding", "kimi-ai"])("%s", (name) => {
    const valid = { device_code: "device", user_code: "user", verification_uri_complete: "https://example.com/verify", expires_in: 600, interval: 5 };
    it.each([undefined, "", "   "])("rejects a missing or blank device code (%s)", async (device_code) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...valid, device_code })));
      const provider = getProvider(name);
      await expect(provider.requestDeviceCode(provider.config)).rejects.toThrow(/missing device_code/);
    });
    it("preserves a valid device authorization response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(valid)));
      const provider = getProvider(name);
      await expect(provider.requestDeviceCode(provider.config)).resolves.toMatchObject(valid);
    });
  });
});
