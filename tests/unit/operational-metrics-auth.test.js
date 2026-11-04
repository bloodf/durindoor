import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ requireLogin: false, passwordSessionEpoch: 1 })),
  validateApiKey: vi.fn(async (key) => ["admin-key", "user-key"].includes(key)),
  getApiKeyByKey: vi.fn(async (key) => ({ isAdmin: key === "admin-key" })),
}));
vi.mock("@/lib/localDb", () => ({ ...db, getSettingsSync: () => ({ passwordSessionEpoch: 1 }), validateGatewayKey: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: async () => "valid-cli-token" }));
vi.mock("@/lib/db/index.js", () => ({ getActiveRequests: async () => ({ activeRequests: [] }) }));

const secret = "test-secret-for-metrics-session-verification";
let oldSecret, GET;
beforeAll(async () => {
  oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  GET = (await import("../../src/app/api/monitoring/metrics/route.js")).GET;
});
afterAll(() => {
  if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
});

function request(headers = {}, token) {
  return { headers: new Headers(headers), cookies: { get: () => token ? { value: token } : undefined } };
}
async function token(expiration, signingKey = secret) {
  return new SignJWT({ authenticated: true, passwordSessionEpoch: 1 })
    .setProtectedHeader({ alg: "HS256" }).setExpirationTime(expiration)
    .sign(new TextEncoder().encode(signingKey));
}

describe("metrics credential verification", () => {
  it("requires verified credentials even with open dashboard or spoofed forwarding", async () => {
    for (const headers of [{}, { host: "localhost", "x-forwarded-for": "127.0.0.1", "x-9r-real-ip": "127.0.0.1" }, { authorization: "Bearer user-key" }, { "x-9r-cli-token": "invalid" }]) {
      expect((await GET(request(headers))).status).toBe(401);
    }
    for (const jwt of ["invalid", await token("1h", "wrong-secret"), await token("-1h")]) {
      expect((await GET(request({}, jwt))).status).toBe(401);
    }
    expect((await GET(request({}, await token("1h")))).status).toBe(200);
    expect((await GET(request({ authorization: "Bearer admin-key" }))).status).toBe(200);
    expect((await GET(request({ "x-9r-cli-token": "valid-cli-token" }))).status).toBe(200);
  });
});
