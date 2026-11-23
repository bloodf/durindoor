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

  it("handles empty responses and exposes HTTP error details", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError(); } })
      .mockResolvedValueOnce({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ error: "Denied" }) })
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new SyntaxError(); } });
    vi.stubGlobal("fetch", fetch);
    expect(await api.get("/empty")).toBeNull();
    await expect(api.get("/denied")).rejects.toMatchObject({ message: "Denied", status: 403, body: { error: "Denied" } });
    await expect(api.get("/bad")).rejects.toMatchObject({ message: "Bad Gateway", status: 502, body: null });
  });
});
