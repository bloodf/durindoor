import { afterEach, describe, expect, it, vi } from "vitest";
import { loadModelAliases, readModelAliases } from "../../src/shared/utils/modelAliases.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

describe("shared model alias read", () => {
  it("sends the same bare request the dashboard consumers sent", async () => {
    const fetch = vi.fn().mockResolvedValue(ok({ aliases: { a: "p/a" } }));
    vi.stubGlobal("fetch", fetch);
    expect(await readModelAliases()).toEqual({ a: "p/a" });
    expect(fetch.mock.calls[0]).toEqual(["/api/models/alias"]);
  });

  it("falls back to an empty map when the body has no aliases", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({})));
    expect(await readModelAliases()).toEqual({});
  });

  it("rejects an HTTP error without reading the body when asked to", async () => {
    const json = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Unavailable", json }));
    await expect(readModelAliases({ skipErrorBody: true })).rejects.toMatchObject({ status: 503 });
    expect(json).not.toHaveBeenCalled();
  });

  it("keeps retained aliases silently on a JSON HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "offline" }) }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const apply = vi.fn();
    await loadModelAliases(apply);
    expect(apply).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["network failure", () => Promise.reject(new TypeError("offline"))],
    ["malformed success body", async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad"); } })],
    ["malformed error body", async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("bad"); } })],
  ])("keeps retained aliases and logs a %s", async (_name, respond) => {
    vi.stubGlobal("fetch", vi.fn(respond));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const apply = vi.fn();
    await loadModelAliases(apply, "Error fetching aliases:");
    expect(apply).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("Error fetching aliases:", expect.any(Error));
  });
});
