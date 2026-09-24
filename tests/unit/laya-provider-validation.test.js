/**
 * Adding a Laya connection: the host alone is enough (no key), and the probe
 * checks /health then whether /v1/systemone accepts the (optional) bearer key.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", ...data })),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn()
}));
vi.mock("open-sse/utils/outboundUrlGuard.js", async (importOriginal) => ({
  ...(await importOriginal()),
  guardedProbeFetch: probe
}));

const { POST: validateProvider } = await import("@/app/api/providers/validate/route.js");
const { POST: createProvider } = await import("@/app/api/providers/route.js");
const models = await import("@/models");

const jsonRequest = (url, body) =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const validate = (body) => validateProvider(jsonRequest("http://localhost/api/providers/validate", body));
const layaBody = (extra = {}) => ({ provider: "laya", providerSpecificData: { baseUrl: "http://127.0.0.1:8000" }, ...extra });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Laya connection validation", () => {
  it("accepts a keyless server that answers /health and does not demand a key", async () => {
    probe.mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 400 }));
    const res = await validate(layaBody());
    expect(await res.json()).toEqual({ valid: true, error: null });
    expect(probe.mock.calls[0][0]).toBe("http://127.0.0.1:8000/health");
    const [url, init] = probe.mock.calls[1];
    expect(url).toBe("http://127.0.0.1:8000/v1/systemone");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("rejects a key the server refuses", async () => {
    probe.mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const res = await validate(layaBody({ apiKey: "wrong" }));
    expect(await res.json()).toEqual({ valid: false, error: "Laya rejected the API key" });
    expect(probe.mock.calls[1][1].headers.Authorization).toBe("Bearer wrong");
  });

  it("reports an unreachable server", async () => {
    probe.mockResolvedValueOnce(new Response("down", { status: 502 }));
    const body = await (await validate(layaBody())).json();
    expect(body.valid).toBe(false);
    expect(body.error).toContain("not reachable");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("reports a refused connection as unreachable", async () => {
    probe.mockRejectedValueOnce(new TypeError("fetch failed"));
    const body = await (await validate(layaBody())).json();
    expect(body).toEqual({ valid: false, error: "Laya server not reachable at http://127.0.0.1:8000" });
  });

  it("creates a keyless connection when a host is given", async () => {
    const res = await createProvider(jsonRequest("http://localhost/api/providers", {
      provider: "laya", name: "Laya", providerSpecificData: { baseUrl: "http://127.0.0.1:8000" }
    }));
    expect(res.status).toBe(201);
    expect(models.createProviderConnection).toHaveBeenCalled();
  });
});
