/**
 * A JWT_SECRET copied from .env.example or the docs is public, so sessions
 * signed with it could be forged (decolua/9router#4286 item 4). DurinDoor
 * ignores it with a warning and treats it as unset: legacy DATA_DIR/jwt-secret
 * if present, otherwise throw.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DOC_ROOTS = [".env.example", "README.md", "docker-compose.yml", "docs", "website"];

/** Literal `JWT_SECRET=value` / `: value` examples in shipped docs → Map(value → file). */
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

function forge(secret) {
  return new SignJWT({ authenticated: true, passwordSessionEpoch: 1 })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(new TextEncoder().encode(secret));
}

async function loadModuleFresh(dataDir, jwtSecret) {
  vi.resetModules();
  process.env.JWT_SECRET = jwtSecret;
  vi.doMock("@/lib/dataDir", () => ({ DATA_DIR: dataDir }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({ passwordSessionEpoch: 1 })),
    getSettingsSync: vi.fn(() => ({ passwordSessionEpoch: 1 })),
  }));
  return await import("../../src/lib/auth/dashboardSession.js");
}

describe("placeholder JWT_SECRET", () => {
  let tempDir;
  let warnSpy;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-jwt-ph-"));
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.JWT_SECRET;
    vi.doUnmock("@/lib/dataDir");
    vi.doUnmock("@/lib/localDb");
    vi.resetModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("fails closed when the only secret is a published example", async () => {
    const { loadJwtSecret } = await loadModuleFresh(tempDir, "replace-me");

    expect(() => loadJwtSecret()).toThrow(/JWT_SECRET environment variable is required/);
    expect(String(warnSpy.mock.calls[0][0])).toContain("published example value");
    expect(fs.readdirSync(tempDir)).toEqual([]);
  });

  it("does not accept a token forged with the .env.example value", async () => {
    fs.writeFileSync(path.join(tempDir, "jwt-secret"), "b".repeat(64), { mode: 0o600 });
    const session = await loadModuleFresh(tempDir, "CHANGE_ME_LONG_RANDOM_SECRET");

    expect(await session.verifyDashboardAuthToken(await forge("CHANGE_ME_LONG_RANDOM_SECRET"))).toBe(false);
    expect(await session.verifyDashboardAuthToken(await session.createDashboardAuthToken())).toBe(true);
  });

  it("keeps honoring an operator-chosen JWT_SECRET", async () => {
    const secret = "f3b1c9e2-operator-chosen-secret-7d41a0";
    const session = await loadModuleFresh(tempDir, secret);

    expect(await session.verifyDashboardAuthToken(await forge(secret))).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // A new JWT_SECRET example in any doc must also be added to PLACEHOLDER_JWT_SECRETS.
  it("covers every literal JWT_SECRET example shipped in the repo docs", async () => {
    const { isPlaceholderJwtSecret } = await loadModuleFresh(tempDir, "");
    const examples = scanDocExamples("JWT_SECRET");

    expect(examples.size).toBeGreaterThan(0);
    for (const [value, file] of examples) {
      expect(isPlaceholderJwtSecret(value), `${value} (${file})`).toBe(true);
    }
  });
});
