/** Password changes share the login lockout, including concurrent guesses (#2580). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: async () => false, isOperatorRequest: async () => true }));
vi.mock("@/lib/settings/settingsPatchAuth", async (original) => ({
  ...(await original()), canModifySecurityCriticalSettings: async () => true,
}));
vi.mock("@/lib/auth/dashboardSession", async (original) => {
  const actual = await original();
  mocks.verify.mockImplementation(actual.verifyDashboardPassword);
  return { ...actual, verifyDashboardPassword: mocks.verify };
});

const password = "correct horse battery";
const previousDataDir = process.env.DATA_DIR;
let dataDir, db, PATCH, limiter, hash;
const patch = (currentPassword) => PATCH(new Request("http://localhost/api/settings", {
  method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ currentPassword, newPassword: "a-brand-new-password" }),
}));

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-password-oracle-"));
  process.env.DATA_DIR = dataDir;
  vi.resetModules();
  db = await import("@/lib/localDb");
  ({ PATCH } = await import("../../src/app/api/settings/route.js"));
  limiter = await import("@/lib/auth/loginLimiter");
  hash = await bcrypt.hash(password, 4);
});
beforeEach(async () => {
  limiter.resetLoginLimiter();
  mocks.verify.mockClear();
  await db.updateSettings({ password: hash, mfaEnabled: false });
});
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

it("locks repeated guesses and permits the correct password after reset", async () => {
  const responses = [];
  for (let i = 0; i < 5; i++) responses.push(await patch("wrong password"));
  expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 429]);
  expect(Number(responses[4].headers.get("Retry-After"))).toBeGreaterThan(0);
  expect((await patch(password)).status).toBe(429);
  expect((await db.getSettings()).password).toBe(hash);
  limiter.resetLoginLimiter();
  expect((await patch(password)).status).toBe(200);
  expect(await bcrypt.compare("a-brand-new-password", (await db.getSettings()).password)).toBe(true);
});

it("reserves slots before checking a concurrent burst", async () => {
  const responses = await Promise.all(Array.from({ length: 20 }, () => patch("wrong password")));
  expect(mocks.verify).toHaveBeenCalledTimes(5);
  expect(responses.filter((response) => response.status === 429).length).toBeGreaterThanOrEqual(15);
  expect((await patch(password)).status).toBe(429);
});
