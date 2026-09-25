/**
 * An INITIAL_PASSWORD copied from .env.example or the docs is as public as the
 * built-in default, so it must not unlock a remote dashboard session
 * (decolua/9router#4289).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const DOC_ROOTS = [".env.example", "README.md", "docker-compose.yml", "docs", "website"];

/** Literal `INITIAL_PASSWORD=value` / `: value` examples in shipped docs → Map(value → file). */
function scanDocExamples(name) {
  const files = [];
  for (const root of DOC_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(abs)) continue;
    if (fs.statSync(abs).isFile()) { files.push(abs); continue; }
    for (const rel of fs.readdirSync(abs, { recursive: true })) {
      if (String(rel).split(path.sep).includes("node_modules")) continue;
      const p = path.join(abs, rel);
      if (/\.(mdx?|ya?ml|example)$/i.test(p) && fs.statSync(p).isFile()) files.push(p);
    }
  }
  const found = new Map();
  const re = new RegExp(`\\b${name}[ \\t]*[=:][ \\t]*["']?([^"'\\s\`]*)`, "g");
  for (const file of files) {
    for (const m of fs.readFileSync(file, "utf8").matchAll(re)) {
      if (m[1] && !/^[$<]/.test(m[1])) found.set(m[1], path.relative(REPO_ROOT, file));
    }
  }
  return found;
}

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
    const examples = scanDocExamples("INITIAL_PASSWORD");

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderInitialPassword(value), `${value} (${file})`).toBe(true);
    }
  });
});
