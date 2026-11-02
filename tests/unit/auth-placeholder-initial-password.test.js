/**
 * An INITIAL_PASSWORD copied from .env.example or the docs is as public as the
 * built-in default, so it must not unlock a remote dashboard session
 * (decolua/9router#4289).
 */
import { fileURLToPath } from "node:url";
import { scanDocExamples } from "../utils/docExamples.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(() => false),
  setDashboardAuthCookie: vi.fn(async () => {}),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ set: vi.fn() })) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getSettingsSync: vi.fn(() => ({})),
}));
vi.mock("@/lib/auth/dashboardSession", async (importOriginal) => ({
  ...(await importOriginal()),
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: () => false }));
vi.mock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: () => true, hasTrustedLocalOrigin: () => true }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ issuePasswordChangeProof: () => "proof" }));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));

const { POST } = await import("../../src/app/api/auth/login/route.js");
const {
  invalidateDefaultPasswordCache,
  isPlaceholderInitialPassword,
  isUsingDefaultPassword,
  validateDashboardPassword,
} = await import("@/lib/auth/dashboardSession");

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

let n = 0;
function login(password) {
  n += 1;
  return POST(new Request("http://durindoor.test/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `198.51.100.${n}` },
    body: JSON.stringify({ password }),
  }));
}

describe("placeholder INITIAL_PASSWORD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    invalidateDefaultPasswordCache();
    mocks.isLocalRequest.mockReturnValue(false);
  });

  it.each(["change-me", "your-password", "replace-me", "CHANGE_ME_STRONG_PASSWORD", " changeme "])(
    "treats %j as the default password",
    async (value) => {
      vi.stubEnv("INITIAL_PASSWORD", value);
      expect(await isUsingDefaultPassword({})).toBe(true);
    },
  );

  it.each(["replace-me", "your-password", "CHANGE_ME_STRONG_PASSWORD"])(
    "refuses a remote session for the documented example %j",
    async (value) => {
      vi.stubEnv("INITIAL_PASSWORD", value);

      const res = await login(value);

      expect(res.status).toBe(403);
      expect((await res.json()).mustChangePassword).toBe(true);
      expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    },
  );

  it("gives the local machine a change-password proof instead of a session", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "replace-me");
    mocks.isLocalRequest.mockReturnValue(true);

    const res = await login("replace-me");
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.requiresPasswordChange).toBe(true);
    expect(body.proof).toBe("proof");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("keeps allowing remote sign-in with an operator-chosen INITIAL_PASSWORD", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "k7#Qv9!operator-chosen");

    const res = await login("k7#Qv9!operator-chosen");

    expect(res.status).toBe(200);
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });

  it("rejects a documented example as a new password", () => {
    expect(validateDashboardPassword("change-me")).toMatch(/example/);
    expect(validateDashboardPassword("k7#Qv9!operator-chosen")).toBeNull();
  });

  // A new INITIAL_PASSWORD example in any doc must also be added to the placeholder list.
  it("covers every literal INITIAL_PASSWORD example shipped in the repo docs", () => {
    const examples = scanDocExamples("INITIAL_PASSWORD", REPO_ROOT);

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderInitialPassword(value), `${value} (${file})`).toBe(true);
    }
  });
});
