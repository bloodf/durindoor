/**
 * SSRF guard wiring tests (OmniRoute #6542 port).
 *
 * WIRING tests, not pure-function tests: each probe seam must keep the
 * (mocked) fetcher call-count at ZERO for a blocked URL, proving the guard
 * runs BEFORE a socket opens and that imports/options are wired correctly.
 * Real production functions are invoked: `probeRegistryProvider`,
 * `probeNoAuthLocalProvider`, and the route `POST` (azure + openai-compatible
 * branches). A regression that drops a guard call or swaps back to bare
 * `fetch` goes red here.
 *
 * Default mode = "block-metadata" (local-first): cloud-metadata + IPv4
 * link-local blocked; LAN/loopback allowed. "public-only" blocks every
 * private/LAN host. "none" (explicit opt-in) skips hostname checks entirely
 * (metadata intentionally allowed). Documented ceilings (DNS rebinding, IPv6
 * link-local under block-metadata) match the OmniRoute source we ported.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRIVATE_ENV = "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS";
const LOCAL_ENV = "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS";
const LEGACY_ENV = "OUTBOUND_SSRF_GUARD_ENABLED";

const METADATA_URL = "http://169.254.169.254/latest/meta-data/";
const GCP_METADATA_URL = "http://metadata.google.internal/computeMetadata/v1/";
const PUBLIC_URL = "https://api.example.com/v1/models";

let savedEnv;

function setGuardEnv(mode) {
  delete process.env[PRIVATE_ENV];
  delete process.env[LOCAL_ENV];
  delete process.env[LEGACY_ENV];
  if (mode === "public-only") process.env[LOCAL_ENV] = "false";
  if (mode === "none") process.env[PRIVATE_ENV] = "true";
}

beforeEach(() => {
  savedEnv = {
    [PRIVATE_ENV]: process.env[PRIVATE_ENV],
    [LOCAL_ENV]: process.env[LOCAL_ENV],
    [LEGACY_ENV]: process.env[LEGACY_ENV],
  };
  vi.resetModules();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.doUnmock("open-sse/config/providers.js");
  vi.doUnmock("open-sse/utils/outboundUrlGuard.js");
  vi.doUnmock("@/models");
  vi.doUnmock("@/shared/constants/providers");
});

describe("outboundUrlGuard — mode contract", () => {
  it("default = block-metadata: metadata blocked, loopback allowed", async () => {
    setGuardEnv("default");
    const { getProviderValidationGuard, assertOutboundUrlAllowed } =
      await import("open-sse/utils/outboundUrlGuard.js");
    expect(getProviderValidationGuard()).toBe("block-metadata");
    expect(() => assertOutboundUrlAllowed(METADATA_URL)).toThrow();
    expect(() => assertOutboundUrlAllowed(GCP_METADATA_URL)).toThrow();
    expect(() => assertOutboundUrlAllowed("http://127.0.0.1:11434/v1")).not.toThrow();
    expect(() => assertOutboundUrlAllowed(PUBLIC_URL)).not.toThrow();
  });

  it("public-only blocks RFC1918 / loopback / IPv4+IPv6 link-local / metadata", async () => {
    setGuardEnv("public-only");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    for (const u of [
      "http://127.0.0.1/v1",
      "http://[::1]/v1",
      "http://10.0.0.1/v1",
      "http://192.168.1.1/v1",
      "http://172.16.0.1/v1",
      "http://100.64.0.1/v1",
      "http://[fe80::1]/v1",
      "http://[febf::1]/v1", // top of fe80::/10 — slips past a naive startsWith("fe80:")
      METADATA_URL,
    ]) {
      expect(() => assertOutboundUrlAllowed(u), u).toThrow();
    }
    expect(() => assertOutboundUrlAllowed(PUBLIC_URL)).not.toThrow();
  });

  it("none mode skips hostname checks (metadata intentionally allowed)", async () => {
    setGuardEnv("none");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    expect(() => assertOutboundUrlAllowed(METADATA_URL)).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://127.0.0.1/v1")).not.toThrow();
  });

  it("protocol + embedded-credential checks apply in EVERY mode incl. none", async () => {
    setGuardEnv("none");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    expect(() => assertOutboundUrlAllowed("file:///etc/passwd")).toThrow();
    expect(() => assertOutboundUrlAllowed("ftp://example.com/v1")).toThrow();
    expect(() => assertOutboundUrlAllowed("http://user:pass@api.example.com/v1")).toThrow();
    expect(() => assertOutboundUrlAllowed("not-a-url")).toThrow();
  });

  it("guardedProbeFetch forces redirect:'manual' (3xx cannot bypass check)", async () => {
    setGuardEnv("default");
    const { guardedProbeFetch } = await import("open-sse/utils/outboundUrlGuard.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    await guardedProbeFetch(PUBLIC_URL, { headers: { a: "b" } }, undefined, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "manual", headers: { a: "b" } });
  });
});

describe("documented ceilings (parity with OmniRoute source — not fixed)", () => {
  it("DNS rebinding: public hostname string is not blocked (guard is host-string only)", async () => {
    setGuardEnv("public-only");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    expect(() => assertOutboundUrlAllowed("http://rebind.attacker.example/v1")).not.toThrow();
  });

  it("IPv6 link-local fe80::/10 is NOT blocked under block-metadata (upstream parity)", async () => {
    setGuardEnv("default");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    expect(() => assertOutboundUrlAllowed("http://[fe80::1]/v1")).not.toThrow();
    expect(() => assertOutboundUrlAllowed("http://[febf::1]/v1")).not.toThrow();
  });

  it("IPv4-mapped IPv6 (::ffff:) treated as private (conservative — pins public ::ffff:8.8.8.8 too)", async () => {
    setGuardEnv("public-only");
    const { assertOutboundUrlAllowed } = await import("open-sse/utils/outboundUrlGuard.js");
    expect(() => assertOutboundUrlAllowed("http://[::ffff:8.8.8.8]/v1")).toThrow();
    expect(() => assertOutboundUrlAllowed("http://[::ffff:127.0.0.1]/v1")).toThrow();
  });
});

describe("wiring — guardedProbeFetch", () => {
  it("blocked URL throws OutboundUrlGuardError synchronously; fetcher never called", async () => {
    setGuardEnv("default");
    const { guardedProbeFetch, OutboundUrlGuardError } =
      await import("open-sse/utils/outboundUrlGuard.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    // Validates BEFORE returning a promise → blocked URL throws synchronously.
    expect(() => guardedProbeFetch(METADATA_URL, {}, undefined, fetcher)).toThrow(OutboundUrlGuardError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("wiring — probeRegistryProvider (real production function, mocked PROVIDERS)", () => {
  function mockProbeProvider({ validateUrl, baseUrl, format = "openai" }) {
    vi.doMock("open-sse/config/providers.js", () => ({
      PROVIDERS: {
        ssrfprobe: {
          format,
          baseUrl,
          ...(validateUrl ? { validateUrl } : {}),
          auth: { header: "Authorization", scheme: "bearer" },
        },
      },
      PROVIDER_OAUTH: {},
    }));
  }

  it("blocked fallback (baseUrl=metadata) → blocked:true, fetcher zero calls", async () => {
    setGuardEnv("default");
    mockProbeProvider({ validateUrl: PUBLIC_URL, baseUrl: METADATA_URL });
    const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await probeRegistryProvider("ssrfprobe", "key", fetcher);
    expect(result).toMatchObject({ valid: false, blocked: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("blocked primary validateUrl=metadata → blocked:true, fetcher zero calls", async () => {
    setGuardEnv("default");
    mockProbeProvider({ validateUrl: METADATA_URL, baseUrl: METADATA_URL });
    const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await probeRegistryProvider("ssrfprobe", "key", fetcher);
    expect(result).toMatchObject({ valid: false, blocked: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("public-only blocks loopback validateUrl → blocked:true, fetcher zero calls", async () => {
    setGuardEnv("public-only");
    mockProbeProvider({
      validateUrl: "http://127.0.0.1:11434/v1/models",
      baseUrl: "http://127.0.0.1:11434/v1/chat/completions",
    });
    const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await probeRegistryProvider("ssrfprobe", "key", fetcher);
    expect(result).toMatchObject({ valid: false, blocked: true });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("allowed public provider → fetcher called with redirect:'manual'", async () => {
    setGuardEnv("default");
    mockProbeProvider({ validateUrl: PUBLIC_URL, baseUrl: "https://api.example.com/v1/chat/completions" });
    const { probeRegistryProvider } = await import("@/app/api/providers/providerProbe.js");
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await probeRegistryProvider("ssrfprobe", "key", fetcher);
    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(fetcher).toHaveBeenCalled();
    for (const call of fetcher.mock.calls) {
      expect(call[1]).toMatchObject({ redirect: "manual" });
    }
  });
});

describe("wiring — probeNoAuthLocalProvider (real route export)", () => {
  it("blocked baseUrl → {blocked:true}, global fetch never called", async () => {
    setGuardEnv("public-only");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200 }));
    const { probeNoAuthLocalProvider } = await import("@/app/api/providers/validate/route.js");
    const result = await probeNoAuthLocalProvider("http://127.0.0.1:11434");
    expect(result).toMatchObject({ valid: false, blocked: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allowed local baseUrl (default mode) → fetch called with redirect:'manual'", async () => {
    setGuardEnv("default");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200 }));
    const { probeNoAuthLocalProvider } = await import("@/app/api/providers/validate/route.js");
    await probeNoAuthLocalProvider("http://127.0.0.1:11434");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });
});

describe("wiring — POST handler (azure + openai-compatible branches, real handler)", () => {
  const makeRequest = (body) => ({ json: async () => body });

  it("azure endpoint=loopback in public-only → 403 {blocked:true}, global fetch zero", async () => {
    setGuardEnv("public-only");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200 }));
    const { POST } = await import("@/app/api/providers/validate/route.js");
    const res = await POST(makeRequest({
      provider: "azure",
      apiKey: "x",
      providerSpecificData: { azureEndpoint: "http://127.0.0.1:8080", deployment: "gpt-4", apiVersion: "2024-02-01" },
    }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ valid: false, blocked: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("generic openai-compatible node baseUrl=metadata → 403 {blocked:true}, global fetch zero", async () => {
    setGuardEnv("default");
    // Route reads node.baseUrl from the model store, NOT the request body.
    vi.doMock("@/models", async (importOriginal) => ({
      ...(await importOriginal()),
      getProviderNodeById: vi.fn(async () => ({ baseUrl: METADATA_URL })),
    }));
    vi.doMock("@/shared/constants/providers", () => ({
      isOpenAICompatibleProvider: (p) => p === "openai-compatible",
      isAnthropicCompatibleProvider: () => false,
      isCustomEmbeddingProvider: () => false,
      AI_PROVIDERS: { "openai-compatible": {} },
    }));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200 }));
    const { POST } = await import("@/app/api/providers/validate/route.js");
    const res = await POST(makeRequest({ provider: "openai-compatible", apiKey: "x", providerSpecificData: {} }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ valid: false, blocked: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("SECAUD gap regressions", () => {
  const makeRequest = (body) => ({ json: async () => body });

  it("trailing-dot metadata FQDN bypass closed (normalizeHost strips trailing '.')", async () => {
    setGuardEnv("default");
    const { assertOutboundUrlAllowed, OutboundUrlGuardError } =
      await import("open-sse/utils/outboundUrlGuard.js");
    for (const u of [
      "http://metadata.google.internal./computeMetadata/v1/",
      "http://metadata.goog./computeMetadata/v1/",
    ]) {
      expect(() => assertOutboundUrlAllowed(u), u).toThrow(OutboundUrlGuardError);
    }
  });

  it("public-only: RFC1918 upper-bound (172.31.255.1), hex IP, IDN localhost blocked", async () => {
    setGuardEnv("public-only");
    const { assertOutboundUrlAllowed, OutboundUrlGuardError } =
      await import("open-sse/utils/outboundUrlGuard.js");
    for (const u of [
      "http://172.31.255.1/v1", // RFC1918 172.16/12 upper bound
      "http://0x7f000001/v1", // hex IP — URL parser canonicalizes to 127.0.0.1
      "http://ⓛocalhost/v1", // unicode IDN — punycodes/normalizes to localhost
    ]) {
      expect(() => assertOutboundUrlAllowed(u), u).toThrow(OutboundUrlGuardError);
    }
  });

  it("client error must NOT echo attacker URL; server still logs original (POST path)", async () => {
    setGuardEnv("default");
    const ATTACKER = "http://metadata.google.internal./computeMetadata/v1/instance/service-accounts/";
    vi.doMock("@/models", async (importOriginal) => ({
      ...(await importOriginal()),
      getProviderNodeById: vi.fn(async () => ({ baseUrl: ATTACKER })),
    }));
    vi.doMock("@/shared/constants/providers", () => ({
      isOpenAICompatibleProvider: (p) => p === "openai-compatible",
      isAnthropicCompatibleProvider: () => false,
      isCustomEmbeddingProvider: () => false,
      AI_PROVIDERS: { "openai-compatible": {} },
    }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({ ok: true, status: 200 }));
    const { POST } = await import("@/app/api/providers/validate/route.js");
    const res = await POST(makeRequest({ provider: "openai-compatible", apiKey: "x", providerSpecificData: {} }));
    expect(res.status).toBe(403);
    const body = await res.json();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(ATTACKER);
    expect(serialized).not.toContain("metadata.google.internal");
    expect(body.error).toBe("URL validation failed");
    expect(fetchSpy).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("metadata.google.internal"); // original retained server-side
  });
});
