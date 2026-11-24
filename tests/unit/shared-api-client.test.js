import { afterEach, describe, expect, it, vi } from "vitest";
import api from "../../src/shared/utils/api.js";

afterEach(() => vi.unstubAllGlobals());

describe("shared HTTP client", () => {
  it("preserves method, merged headers, body and signal", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: true }) });
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await api.patch("/settings", { enabled: true }, { method: "GET", headers: { "X-Test": "yes" }, signal })).toEqual({ saved: true });
    expect(fetch).toHaveBeenCalledWith("/settings", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Test": "yes" }, signal, body: '{"enabled":true}' });
  });

  it("accepts null options for mutation wrappers", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ saved: true }) });
    vi.stubGlobal("fetch", fetch);
    for (const [send, method] of [[api.post, "POST"], [api.put, "PUT"], [api.patch, "PATCH"]]) {
      expect(await send("/settings", {}, null)).toEqual({ saved: true });
      expect(fetch).toHaveBeenLastCalledWith("/settings", {
        method, headers: { "Content-Type": "application/json" }, body: "{}",
      });
    }
    expect(await api.del("/settings", null)).toEqual({ saved: true });
    expect(fetch).toHaveBeenLastCalledWith("/settings", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
    });
  });

  it("handles empty responses and exposes HTTP error details", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError(); } })
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ error: "Denied" }) })
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new SyntaxError(); } });
    vi.stubGlobal("fetch", fetch);
    expect(await api.get("/empty")).toBeNull();
    await expect(api.get("/denied")).rejects.toMatchObject({ message: "Denied", status: 403, body: { error: "Denied" } });
    await expect(api.get("/bad")).rejects.toMatchObject({ message: "Bad Gateway", status: 502, body: null });
  });

  it("can reject a GET from the status without reading a deferred error body", async () => {
    const deferredBody = new Promise(() => {});
    const json = vi.fn(() => deferredBody);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable", json });
    vi.stubGlobal("fetch", fetch);

    await expect(api.get("/status", { cache: "no-store", skipErrorBody: true }))
      .rejects.toMatchObject({ message: "Service Unavailable", status: 503, body: null });
    expect(json).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("/status", { cache: "no-store", headers: { "Content-Type": "application/json" } });
  });

  it("supports strict JSON per request without changing tolerant defaults", async () => {
    const parseError = new SyntaxError("malformed response");
    const parse = vi.fn().mockRejectedValue(parseError);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 204, json: parse })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => null })
      .mockResolvedValueOnce({ ok: false, status: 500, json: parse })
      .mockResolvedValueOnce({ ok: true, status: 200, json: parse }));
    expect(await api.del("/empty", { strictJson: true })).toBeNull();
    expect(parse).not.toHaveBeenCalled();
    expect(await api.post("/null", {}, { strictJson: true })).toBeNull();
    await expect(api.put("/bad", {}, { strictJson: true })).rejects.toBe(parseError);
    expect(await api.get("/tolerant")).toBeNull();
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("strictJson");
  });

});
