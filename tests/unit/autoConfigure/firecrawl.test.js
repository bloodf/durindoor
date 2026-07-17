import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { configureFirecrawl } from "../../../src/lib/autoConfigure/firecrawl.js";

const originalEnv = process.env;

describe("configureFirecrawl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.FIRECRAWL_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    delete process.env.FIRECRAWL_API_KEY;
  });

  it("returns no change when firecrawl not detected", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: false, error: "offline" });
    const res = await configureFirecrawl({ firecrawlBaseUrl: "" }, { probe });
    expect(res.detected).toBe(false);
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });

  it("applies settings and prepares connection when detected", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([]);
    const res = await configureFirecrawl(
      { firecrawlBaseUrl: "" },
      { probe, listConnections, apiKey: "abc" }
    );
    expect(res.detected).toBe(true);
    expect(res.changed).toBe(true);
    expect(res.updates).toEqual({ firecrawlBaseUrl: "http://127.0.0.1:3002" });
    expect(res.connection).toBeTruthy();
    expect(res.connection.apiKey).toBe("abc");
  });

  it("reuses env api key and leaves no placeholder", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([]);
    const res = await configureFirecrawl({ firecrawlBaseUrl: "" }, { probe, listConnections });
    expect(res.connection.apiKey).toBeNull();
    expect(res.connection.authType).toBe("noauth");
  });

  it("is idempotent when settings and connection match", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([
      {
        id: "c1",
        provider: "firecrawl_custom",
        isActive: true,
        name: "Firecrawl Local",
        apiKey: null,
        firecrawlHeaders: null,
        providerSpecificData: { baseUrl: "http://127.0.0.1:3002" },
      },
    ]);
    const res = await configureFirecrawl(
      { firecrawlBaseUrl: "http://127.0.0.1:3002" },
      { probe, listConnections }
    );
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
    expect(res.connection).toBeNull();
  });

  it("uses FIRECRAWL_API_KEY env when no option provided via runAutoConfigure", async () => {
    process.env.FIRECRAWL_API_KEY = "env-key";
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([]);
    const { runAutoConfigure } = await import("../../../src/lib/autoConfigure/index.js");
    const res = await runAutoConfigure(
      { firecrawlBaseUrl: "" },
      { firecrawl: { probe, listConnections } }
    );
    expect(res.services.firecrawl.connection.apiKey).toBe("env-key");
  });

  it("preserves existing keyed connection credentials when env and options omit apiKey/headers", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([
      {
        id: "c1",
        provider: "firecrawl_custom",
        isActive: true,
        name: "Firecrawl Local",
        apiKey: "stored-key",
        firecrawlHeaders: '{"X-Custom":"yes"}',
        providerSpecificData: { baseUrl: "http://127.0.0.1:3002" },
      },
    ]);
    const res = await configureFirecrawl(
      { firecrawlBaseUrl: "http://127.0.0.1:3002" },
      { probe, listConnections }
    );
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
    expect(res.connection).toBeNull();
  });

  it("overwrites existing apiKey when env key is explicitly provided", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([
      {
        id: "c1",
        provider: "firecrawl_custom",
        isActive: true,
        name: "Firecrawl Local",
        apiKey: "stored-key",
        firecrawlHeaders: null,
        providerSpecificData: { baseUrl: "http://127.0.0.1:3002" },
      },
    ]);
    const res = await configureFirecrawl(
      { firecrawlBaseUrl: "http://127.0.0.1:3002" },
      { probe, listConnections, apiKey: "" }
    );
    expect(res.changed).toBe(true);
    expect(res.connection).toBeTruthy();
    expect(res.connection.apiKey).toBeNull();
  });

  it("dry-run reports changes without applying", async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, baseUrl: "http://127.0.0.1:3002" });
    const listConnections = vi.fn().mockResolvedValue([]);
    const res = await configureFirecrawl(
      { firecrawlBaseUrl: "" },
      { probe, listConnections, dryRun: true }
    );
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(true);
    expect(res.updates).toEqual({});
    expect(res.connection).toBeNull();
  });
});
