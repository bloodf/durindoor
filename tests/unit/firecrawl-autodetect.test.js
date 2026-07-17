/**
 * Unit tests for Firecrawl auto-detect module and self-hosted security rules.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateFirecrawlBaseUrl,
  validateFirecrawlApiKey,
  validateFirecrawlHeaders,
  ALLOWED_FIRECRAWL_HOSTS,
} from "open-sse/shared/firecrawlConfig.js";
import {
  getProviderConnections,
  createProviderConnection,
  updateProviderConnection,
} from "@/lib/localDb";
import {
  probeFirecrawlEndpoint,
  probeDefaultFirecrawlEndpoints,
  upsertFirecrawlCustomConnection,
} from "@/lib/firecrawl/firecrawlConfig.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  createProviderConnection: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

const originalFetch = global.fetch;

describe("Firecrawl security validators", () => {
  it("allows localhost, loopback and RFC1918", () => {
    expect(validateFirecrawlBaseUrl("http://localhost:3002").ok).toBe(true);
    expect(validateFirecrawlBaseUrl("http://127.0.0.1:3002").ok).toBe(true);
    expect(validateFirecrawlBaseUrl("http://[::1]:3002").ok).toBe(true);
    expect(validateFirecrawlBaseUrl("http://10.0.0.1:3002").ok).toBe(true);
    expect(validateFirecrawlBaseUrl("http://192.168.1.50:3002").ok).toBe(true);
  });

  it("blocks public and metadata hosts", () => {
    expect(validateFirecrawlBaseUrl("http://example.com:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://metadata.google.internal/").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://169.254.169.254/").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://0.0.0.0:3002").ok).toBe(false);
  });

  it("rejects malformed IPv4-like hosts", () => {
    expect(validateFirecrawlBaseUrl("http://10.0.0.1evil:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://192.168.1.01:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://08.08.08.08:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("  http://192.168.1.01:3002  ").ok).toBe(false);
  });

  it("rejects public hostnames starting with fc/fd", () => {
    expect(validateFirecrawlBaseUrl("http://fc.example.com:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("http://fd.example.com:3002").ok).toBe(false);
  });

  it("rejects URL credentials and non-HTTP protocols", () => {
    expect(validateFirecrawlBaseUrl("http://user:pass@127.0.0.1:3002").ok).toBe(false);
    expect(validateFirecrawlBaseUrl("ftp://127.0.0.1:3002").ok).toBe(false);
  });

  it("rejects invalid headers", () => {
    expect(validateFirecrawlHeaders({ host: "x" }).ok).toBe(false);
    expect(validateFirecrawlHeaders({ "x-ok": "value\ninjection" }).ok).toBe(false);
    expect(validateFirecrawlHeaders([]).ok).toBe(false);
    expect(validateFirecrawlHeaders(new Array(17).fill(0).reduce((a, _, i) => (a[i] = i, a), {})).ok).toBe(false);
  });

  it("allows valid header objects", () => {
    const v = validateFirecrawlHeaders({ "x-custom": "value" });
    expect(v.ok).toBe(true);
    expect(v.headers).toEqual({ "x-custom": "value" });
  });

  it("validates API keys as printable strings", () => {
    expect(validateFirecrawlApiKey("").ok).toBe(true);
    expect(validateFirecrawlApiKey("fc-key").ok).toBe(true);
    expect(validateFirecrawlApiKey({}).ok).toBe(false);
    expect(validateFirecrawlApiKey("a".repeat(4097)).ok).toBe(false);
  });
});

describe("Firecrawl auto-detect probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("probes /test endpoint and returns ok on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await probeFirecrawlEndpoint("http://127.0.0.1:3002", { apiKey: "fc-key" });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/test",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer fc-key" }),
      })
    );
  });

  it("returns 503-style failure when probe fails", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));
    const res = await probeFirecrawlEndpoint("http://127.0.0.1:3002");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Connection refused");
  });

  it("preserves base path when probing /test", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const res = await probeFirecrawlEndpoint("http://127.0.0.1:3002/firecrawl", { apiKey: "fc-key" });
    expect(res.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3002/firecrawl/test",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ authorization: "Bearer fc-key" }),
      })
    );
  });

  it("scans default loopback candidates sequentially", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("refused"));
    const res = await probeDefaultFirecrawlEndpoints();
    expect(res.ok).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenNthCalledWith(1, "http://127.0.0.1:3002/test", expect.anything());
    expect(global.fetch).toHaveBeenNthCalledWith(2, "http://[::1]:3002/test", expect.anything());
  });
});

describe("Firecrawl custom connection upsert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds payload with API key and headers fields", async () => {
    getProviderConnections.mockResolvedValue([]);
    createProviderConnection.mockImplementation((c) => ({ ...c, id: "conn-1" }));

    const conn = await upsertFirecrawlCustomConnection({
      baseUrl: "http://127.0.0.1:3002",
      apiKey: "fc-key",
      headers: { "x-custom": "value" },
      isActive: false,
    });

    expect(conn.id).toBe("conn-1");
    expect(createProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "fc-key",
        firecrawlHeaders: JSON.stringify({ "x-custom": "value" }),
        providerSpecificData: { baseUrl: "http://127.0.0.1:3002" },
      })
    );
  });

  it("updates the active connection before unnamed ones", async () => {
    const active = { id: "active-1", isActive: true, name: "Custom" };
    const other = { id: "other-1", isActive: false, name: "Firecrawl Local" };
    getProviderConnections.mockResolvedValue([other, active]);
    updateProviderConnection.mockImplementation((id, c) => ({ ...c, id }));

    await upsertFirecrawlCustomConnection({ baseUrl: "http://127.0.0.1:3002" });

    expect(updateProviderConnection).toHaveBeenCalledWith("active-1", expect.anything());
  });

  it("explicitly clears stored apiKey when re-detected with blank key", async () => {
    const existing = { id: "fc-1", provider: "firecrawl_custom", isActive: true, apiKey: "old-key", firecrawlHeaders: "{}", providerSpecificData: { baseUrl: "http://127.0.0.1:3002" } };
    getProviderConnections.mockResolvedValue([existing]);
    updateProviderConnection.mockImplementation((id, c) => ({ ...c, id }));

    await upsertFirecrawlCustomConnection({ baseUrl: "http://127.0.0.1:3002", apiKey: "" });

    expect(updateProviderConnection).toHaveBeenCalledWith(
      "fc-1",
      expect.objectContaining({ apiKey: null })
    );
  });
});

it("exports ALLOWED_FIRECRAWL_HOSTS", () => {
  expect(ALLOWED_FIRECRAWL_HOSTS).toContain("127.0.0.1");
});
