/**
 * SEC-A-01: SSRF hardening on /api/provider-nodes/validate.
 *
 * WIRING tests — the route previously short-circuited the outbound-URL
 * guard on loopback origins, letting a caller POST a metadata URL through
 * the embeddings/models/chat probes and read the upstream body back via
 * the error echo. The fix:
 *   - every fetch goes through `guardedProbeFetch` (runs
 *     `assertOutboundUrlAllowed` BEFORE the socket opens, forces
 *     `redirect:"manual"`)
 *   - `type` is allowlisted (openai-compatible | anthropic-compatible |
 *     custom-embedding)
 *   - the upstream response body is never echoed back
 *
 * Each blocked-URL case asserts the (mocked) fetch call-count is ZERO,
 * proving the guard runs before the request is opened. Cases run under
 * BOTH the default "block-metadata" mode (loopback callers included) and
 * "public-only" mode (LAN/loopback also blocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRIVATE_ENV = "OMNIROUTE_ALLOW_PRIVATE_PROVIDER_URLS";
const LOCAL_ENV = "OMNIROUTE_ALLOW_LOCAL_PROVIDER_URLS";
const LEGACY_ENV = "OUTBOUND_SSRF_GUARD_ENABLED";

const METADATA_BASE = "http://169.254.169.254/latest/meta-data";
const GCP_METADATA_BASE = "http://metadata.google.internal/computeMetadata/v1";
const PUBLIC_BASE = "https://api.example.com/v1";
const LAN_BASE = "http://192.168.1.10:11434/v1";
const LOOPBACK_BASE = "http://127.0.0.1:11434/v1";

const originalFetch = global.fetch;
let savedEnv;

function setGuardEnv(mode) {
  delete process.env[PRIVATE_ENV];
  delete process.env[LOCAL_ENV];
  delete process.env[LEGACY_ENV];
  if (mode === "public-only") process.env[LOCAL_ENV] = "false";
  if (mode === "none") process.env[PRIVATE_ENV] = "true";
}

function makeRequest(body, { origin = "loopback" } = {}) {
  // Loopback caller: remoteAddress/socket are default; remote caller is
  // indicated by an x-9r-via-proxy header (matches dashboardGuard.js). The
  // route must apply the SSRF guard EITHER WAY, so both origins are used
  // in the tests below.
  const headers = { "content-type": "application/json" };
  if (origin === "remote") headers["x-9r-via-proxy"] = "1";
  return new Request("http://localhost/api/provider-nodes/validate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  savedEnv = {
    [PRIVATE_ENV]: process.env[PRIVATE_ENV],
    [LOCAL_ENV]: process.env[LOCAL_ENV],
    [LEGACY_ENV]: process.env[LEGACY_ENV],
  };
  vi.resetModules();
  global.fetch = vi.fn();
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("/api/provider-nodes/validate — SSRF guard wiring", () => {
  it("blocks IPv4 link-local (169.254.x.x) baseUrl for a LOOPBACK caller; fetch never called", async () => {
    setGuardEnv("default"); // block-metadata
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    const res = await POST(makeRequest({
      baseUrl: METADATA_BASE,
      apiKey: "sk-test",
      type: "openai-compatible",
    }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toMatchObject({ valid: false, blocked: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks IPv4 link-local baseUrl for a REMOTE caller; fetch never called", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    const res = await POST(makeRequest({
      baseUrl: METADATA_BASE,
      apiKey: "sk-test",
      type: "openai-compatible",
    }, { origin: "remote" }));
    expect(res.status).toBe(403);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("blocks GCP metadata hostname for both caller origins", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    for (const origin of ["loopback", "remote"]) {
      const res = await POST(makeRequest({
        baseUrl: GCP_METADATA_BASE,
        apiKey: "sk-test",
        type: "custom-embedding",
        modelId: "m1",
      }, { origin }));
      expect(res.status).toBe(403);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("public-only mode additionally blocks LAN + loopback baseUrl (loopback caller)", async () => {
    setGuardEnv("public-only");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    for (const base of [LAN_BASE, LOOPBACK_BASE]) {
      const res = await POST(makeRequest({
        baseUrl: base,
        apiKey: "sk-test",
        type: "openai-compatible",
      }));
      expect(res.status, base).toBe(403);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects non-http(s) baseUrl schemes (file, ftp, gopher) with 400", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    for (const base of [
      "file:///etc/passwd",
      "ftp://example.com/v1",
      "gopher://example.com:70/_",
      "javascript:alert(1)",
    ]) {
      const res = await POST(makeRequest({
        baseUrl: base,
        apiKey: "sk-test",
        type: "openai-compatible",
      }));
      expect(res.status, base).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/url/i);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects `type` values outside the allowlist before any fetch", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    for (const type of ["unknown", "custom-google", "custom-openai", "custom-anthropic", "", null]) {
      const res = await POST(makeRequest({
        baseUrl: PUBLIC_BASE,
        apiKey: "sk-test",
        type,
      }));
      expect(res.status, `type=${type}`).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/type/i);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("accepts every allowlisted type for a public baseUrl (loopback caller)", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
    });
    for (const type of ["openai-compatible", "anthropic-compatible", "custom-embedding"]) {
      const body = { baseUrl: PUBLIC_BASE, apiKey: "sk-test", type };
      if (type === "custom-embedding") body.modelId = "m1";
      const res = await POST(makeRequest(body));
      expect(res.status, type).toBe(200);
    }
  });

  it("loops every fetch through guardedProbeFetch (redirect:'manual' set on every call)", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await POST(makeRequest({
      baseUrl: PUBLIC_BASE,
      apiKey: "sk-test",
      type: "openai-compatible",
    }));
    expect(global.fetch).toHaveBeenCalled();
    const [, init] = global.fetch.mock.calls[0];
    expect(init.redirect).toBe("manual");
  });

  it("custom-embedding error path does NOT echo upstream body (no blind-SSRF leak)", async () => {
    setGuardEnv("default");
    const { POST } = await import("@/app/api/provider-nodes/validate/route.js");
    const upstreamSecret = "AKIA-UPSTREAM-LEAK-DO-NOT-ECHO";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => upstreamSecret,
      json: async () => ({}),
    });
    const res = await POST(makeRequest({
      baseUrl: PUBLIC_BASE,
      apiKey: "sk-test",
      type: "custom-embedding",
      modelId: "m1",
    }));
    expect(res.status).toBe(200); // 200 with { valid:false } — route contract
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.status).toBe(500);
    expect(json.error || "").not.toContain(upstreamSecret);
    expect(json.error || "").not.toMatch(/echo/i);
    expect(JSON.stringify(json)).not.toContain(upstreamSecret);
  });
});
