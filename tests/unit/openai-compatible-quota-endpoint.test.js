import { describe, expect, it, vi } from "vitest";
import { getProviderQuotaAdapter } from "../../open-sse/services/quota/providers/index.js";
import { resolveQuotaPath } from "../../open-sse/services/quota/providers/openaiCompatible.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function context(connectionOverrides, fetchImpl) {
  const provider = "openai-compatible-acme-1";
  const adapter = getProviderQuotaAdapter(provider);
  return {
    adapter,
    context: {
      config: adapter.config,
      connection: { id: "conn-1", provider, providerSpecificData: {}, ...connectionOverrides },
      fetchImpl,
      proxyOptions: { strictProxy: true },
      signal: new AbortController().signal,
      now: () => NOW,
      timeoutMs: 1_000,
      maxResponseBytes: 64 * 1024
    }
  };
}

describe("resolveQuotaPath", () => {
  it("walks dot and bracket paths, returning undefined for missing hops", () => {
    const body = { data: { used_usd: 4.5, items: [{ plan: "pro" }] } };
    expect(resolveQuotaPath(body, "$.data.used_usd")).toBe(4.5);
    expect(resolveQuotaPath(body, "$.data.items[0].plan")).toBe("pro");
    expect(resolveQuotaPath(body, "$.data.missing.path")).toBeUndefined();
    expect(resolveQuotaPath(body, "not-a-path")).toBeUndefined();
  });
});

describe("openai-compatible quota endpoint adapter", () => {
  it("routes both compatible-prefixed provider ids to the same adapter", () => {
    expect(getProviderQuotaAdapter("openai-compatible-acme-1").config.adapter).toBe("openaiCompatible");
    expect(getProviderQuotaAdapter("anthropic-compatible-acme-2").config.adapter).toBe("openaiCompatible");
  });

  it("reports missing when the connection has no quotaEndpoint configured", async () => {
    const fetchImpl = vi.fn();
    const { adapter, context: ctx } = context({ apiKey: "sk-test" }, fetchImpl);
    await expect(adapter.fetchQuota(ctx)).resolves.toMatchObject({ outcome: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches, authenticates with bearer, and maps configured quotas", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ data: { used_usd: 4, limit_usd: 20, renews_at: "2026-02-01T00:00:00.000Z" } })
    );
    const { adapter, context: ctx } = context(
      {
        apiKey: "sk-test",
        providerSpecificData: {
          quotaEndpoint: {
            url: "https://api.example.com/v1/credits",
            auth: "bearer",
            quotas: {
              credits: { used: "$.data.used_usd", total: "$.data.limit_usd", resetAt: "$.data.renews_at", currency: "usd" }
            }
          }
        }
      },
      fetchImpl
    );
    const result = await adapter.fetchQuota(ctx);
    expect(result.outcome).toBe("success");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].amounts).toMatchObject({ limit: 20, used: 4, remaining: 16, unit: "usd" });
    expect(result.rows[0].resetAt).toBe("2026-02-01T00:00:00.000Z");
    const [, requestOptions] = fetchImpl.mock.calls[0];
    expect(requestOptions.headers.Authorization).toBe("Bearer sk-test");
  });

  it("never reports a resolved quota when only one axis resolves (no 0/0 illusion)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: { used_usd: 4 } }));
    const { adapter, context: ctx } = context(
      {
        apiKey: "sk-test",
        providerSpecificData: {
          quotaEndpoint: {
            url: "https://api.example.com/v1/credits",
            quotas: { credits: { used: "$.data.used_usd", total: "$.data.missing_total" } }
          }
        }
      },
      fetchImpl
    );
    await expect(adapter.fetchQuota(ctx)).resolves.toMatchObject({ outcome: "malformed" });
  });
});
