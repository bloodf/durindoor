/**
 * #2579: settings re-auth reserves lockout slots, never accepts the initial
 * password, requires MFA, and gates the traffic-redirecting settings.
 * Real settings DB, limiter and MFA; only the session/CLI proof is mocked.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, isOperatorRequest: async () => true }));
vi.mock("@/lib/settings/settingsPatchAuth", async (importOriginal) => ({
  ...(await importOriginal()), canModifySecurityCriticalSettings: async () => true,
}));
vi.mock("@/lib/auth/dashboardSession", async (importOriginal) => {
  const actual = await importOriginal();
  mocks.verify.mockImplementation(actual.verifyDashboardPassword);
  return { ...actual, verifyDashboardPassword: mocks.verify };
});

const PASSWORD = "correct horse battery";
const SAFE = {
  requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false, authMode: "password",
  headroomEnabled: false, headroomUrl: "http://localhost:8787", headroomCompressUserMessages: false,
  outboundProxyEnabled: false, outboundProxyUrl: "", outboundNoProxy: "",
  mitmRouterBaseUrl: "http://localhost:20128", enableSessionCapture: false, logToolSources: false,
  lanDiscoveryEnabled: false, enableObservability: false,
};

const previous = { DATA_DIR: process.env.DATA_DIR, INITIAL_PASSWORD: process.env.INITIAL_PASSWORD };
let dataDir, db, PATCH, limiter, totp, hash, secret;

const patch = (body) => PATCH(new Request("http://localhost/api/settings", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
const stored = () => db.getSettings();
const code = () => totp.generateTotpCode(secret, totp.totpCounter());
const wrongCode = () => {
  const counter = totp.totpCounter();
  const valid = [-1, 0, 1, 2].map((step) => totp.generateTotpCode(secret, counter + step));
  return ["000000", "111111", "222222", "333333", "444444"].find((value) => !valid.includes(value));
};
const enableMfa = () => db.updateSettings({ mfaEnabled: true, mfaSecret: secret, mfaBackupCodes: [] });

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-settings-reauth-"));
  process.env.DATA_DIR = dataDir;
  delete process.env.INITIAL_PASSWORD;
  vi.resetModules();
  db = await import("@/lib/localDb");
  ({ PATCH } = await import("../../src/app/api/settings/route.js"));
  limiter = await import("@/lib/auth/loginLimiter");
  totp = await import("../../src/lib/auth/totp.js");
  secret = totp.generateTotpSecret();
  hash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(async () => {
  delete process.env.INITIAL_PASSWORD;
  limiter.resetLoginLimiter();
  mocks.verify.mockClear();
  await db.updateSettings({ ...SAFE, password: hash, mfaEnabled: false, mfaSecret: "", mfaLastTotpCounter: null });
});

afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe("#2579 (1): the lockout is reserved atomically", () => {
  it("stops a concurrent burst of wrong passwords at the limit", async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => patch({ requireLogin: false, currentPassword: `guess-${i}` })),
    );

    expect(mocks.verify).toHaveBeenCalledTimes(5);
    expect(responses.filter((r) => r.status === 429).length).toBeGreaterThanOrEqual(15);
    expect((await stored()).requireLogin).toBe(true);
    expect((await patch({ requireLogin: false, currentPassword: PASSWORD })).status).toBe(429);
    expect(mocks.verify).toHaveBeenCalledTimes(5);
  });
});

describe("#2579 (2): the initial password never confirms a change", () => {
  it.each([["the built-in default", undefined, "123456"], ["INITIAL_PASSWORD", "from-the-env-file", "from-the-env-file"]])(
    "refuses %s when no password is stored",
    async (_label, env, guess) => {
      if (env) process.env.INITIAL_PASSWORD = env;
      await db.updateSettings({ password: "" });

      const response = await patch({ requireApiKey: false, currentPassword: guess });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toMatchObject({ code: "PASSWORD_NOT_SET", fields: ["requireApiKey"] });
      expect(body.error).toMatch(/Set a password or re-login via OIDC/);
      expect((await stored()).requireApiKey).toBe(true);
    },
  );

  it("does not let a password change carry a gated change on the initial password", async () => {
    await db.updateSettings({ password: "" });

    const response = await patch({ requireApiKey: false, currentPassword: "123456", newPassword: "a-brand-new-password" });

    expect(response.status).toBe(403);
    expect(await stored()).toMatchObject({ requireApiKey: true, password: "" });
  });
});

describe("#2579 (3): MFA is required when enabled", () => {
  beforeEach(enableMfa);

  it("asks for the code without counting a failure, then accepts a valid one", async () => {
    for (let i = 0; i < 6; i++) {
      const response = await patch({ requireLogin: false, currentPassword: PASSWORD });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED", mfaRequired: true });
    }
    expect((await stored()).requireLogin).toBe(true);

    expect((await patch({ requireLogin: false, currentPassword: PASSWORD, mfaCode: code() })).status).toBe(200);
    const saved = await stored();
    expect(saved.requireLogin).toBe(false);
    expect(saved).not.toHaveProperty("mfaCode");
    expect(saved).not.toHaveProperty("currentPassword");
  });

  it("counts wrong codes toward the lockout", async () => {
    const mfaCode = wrongCode();
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push((await patch({ requireLogin: false, currentPassword: PASSWORD, mfaCode })).status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 429]);
    expect((await patch({ requireLogin: false, currentPassword: PASSWORD, mfaCode: code() })).status).toBe(429);
    expect((await stored()).requireLogin).toBe(true);
  });

  it("does not spend a code on a request that fails validation", async () => {
    const mfaCode = code();
    const credentials = { currentPassword: PASSWORD, mfaCode };

    expect((await patch({ outboundProxyEnabled: true, outboundProxyUrl: "ftp://nope", ...credentials })).status).toBe(400);
    expect((await patch({ requireLogin: false, ...credentials })).status).toBe(200);
  });

  it("verifies one code once for a password change that also carries a gated change", async () => {
    const response = await patch({
      requireLogin: false, currentPassword: PASSWORD, newPassword: "a-brand-new-password", mfaCode: code(),
    });

    expect(response.status).toBe(200);
    const saved = await stored();
    expect(saved.requireLogin).toBe(false);
    expect(saved.password).not.toBe(hash);
  });
});

describe("#2579 (4): traffic-redirecting and exposing settings are gated", () => {
  it.each([
    ["headroomEnabled", true],
    ["headroomUrl", "http://attacker.example:8787"],
    ["headroomCompressUserMessages", true],
    ["outboundProxyEnabled", true],
    ["outboundProxyUrl", "http://attacker.example:3128"],
    ["outboundNoProxy", "internal.example"],
    ["mitmRouterBaseUrl", "http://attacker.example"],
    ["enableSessionCapture", true],
    ["logToolSources", true],
    ["lanDiscoveryEnabled", true],
    ["enableObservability", true],
  ])("needs the password to change %s", async (key, value) => {
    const refused = await patch({ [key]: value });

    expect(refused.status).toBe(401);
    expect(await refused.json()).toMatchObject({ code: "REAUTH_REQUIRED", fields: [key] });
    expect((await stored())[key]).toEqual(SAFE[key]);
    expect((await patch({ [key]: value, currentPassword: PASSWORD })).status).toBe(200);
    expect((await stored())[key]).toEqual(value);
  });

  it("never asks to turn protections back on or to re-save stored values", async () => {
    const widened = {
      requireLogin: false, requireApiKey: false, tunnelDashboardAccess: true, headroomEnabled: true,
      headroomCompressUserMessages: true, outboundProxyEnabled: true, enableSessionCapture: true,
      logToolSources: true, lanDiscoveryEnabled: true, enableObservability: true,
      headroomUrl: "http://headroom.internal:8787", outboundProxyUrl: "http://proxy.internal:3128",
      outboundNoProxy: "localhost", mitmRouterBaseUrl: "http://router.internal:20128",
    };
    await db.updateSettings(widened);

    expect((await patch(widened)).status).toBe(200);
    expect((await patch({
      requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false, headroomEnabled: false,
      headroomCompressUserMessages: false, outboundProxyEnabled: false, enableSessionCapture: false,
      logToolSources: false, lanDiscoveryEnabled: false, enableObservability: false,
    })).status).toBe(200);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe("#2579: the password prompt asks for the MFA code", () => {
  it("follows the refusal's mfaRequired flag and resolves the code with the password", async () => {
    const { Window } = await import("happy-dom");
    const window = new Window();
    vi.stubGlobal("window", window);
    vi.stubGlobal("document", window.document);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const React = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { usePasswordPrompt } = await import("@/shared/hooks/usePasswordPrompt");
    let api;
    const Probe = () => { api = usePasswordPrompt(); return null; };
    const root = createRoot(window.document.createElement("div"));
    try {
      await React.act(async () => root.render(React.createElement(Probe)));
      let answer;
      await React.act(async () => { answer = api.confirmPassword({ mfaRequired: true }); });
      expect(api.prompt.mfaRequired).toBe(true);
      await React.act(async () => api.prompt.setMfaCode("123456"));
      await React.act(async () => api.prompt.finish(PASSWORD, api.prompt.mfaCode));
      await expect(answer).resolves.toEqual({ currentPassword: PASSWORD, mfaCode: "123456" });
      expect(api.prompt.mfaCode).toBe("");

      await React.act(async () => { answer = api.confirmPassword(); });
      expect(api.prompt.mfaRequired).toBe(false);
      await React.act(async () => api.prompt.finish(PASSWORD));
      await expect(answer).resolves.toBe(PASSWORD);
    } finally {
      await React.act(async () => root.unmount());
      vi.unstubAllGlobals();
      await window.happyDOM.close();
    }
  });
});
