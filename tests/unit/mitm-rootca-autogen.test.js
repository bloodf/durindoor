import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const rootCAPath = require.resolve("../../src/mitm/cert/rootCA.js");
const pathsPath = require.resolve("../../src/mitm/paths.js");

function loadRootCAWithDataDir(dataDir) {
  delete require.cache[rootCAPath];
  delete require.cache[pathsPath];

  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    return require("../../src/mitm/cert/rootCA.js");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}

describe("MITM Root CA auto-generation (#2224)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-rootca-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[rootCAPath];
    delete require.cache[pathsPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates rootCA.key and rootCA.crt when both are absent", () => {
    const { ensureRootCASync, isCertExpired, ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(tmpDir);

    expect(ensureRootCASync()).toBe(true);
    expect(fs.existsSync(ROOT_CA_KEY_PATH)).toBe(true);
    expect(fs.existsSync(ROOT_CA_CERT_PATH)).toBe(true);
    expect(isCertExpired(ROOT_CA_CERT_PATH)).toBe(false);
  });

  it("is idempotent when valid cert already exists (returns false)", () => {
    const { ensureRootCASync, ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(tmpDir);

    expect(ensureRootCASync()).toBe(true);
    const key = fs.readFileSync(ROOT_CA_KEY_PATH, "utf8");
    const cert = fs.readFileSync(ROOT_CA_CERT_PATH, "utf8");

    expect(ensureRootCASync()).toBe(false);
    expect(fs.readFileSync(ROOT_CA_KEY_PATH, "utf8")).toBe(key);
    expect(fs.readFileSync(ROOT_CA_CERT_PATH, "utf8")).toBe(cert);
  });

  it("regenerates when rootCA.crt is corrupt / unreadable", () => {
    const { ensureRootCASync, isCertExpired, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(tmpDir);

    ensureRootCASync();
    fs.writeFileSync(ROOT_CA_CERT_PATH, "not-a-pem");

    expect(ensureRootCASync()).toBe(true);
    expect(fs.readFileSync(ROOT_CA_CERT_PATH, "utf8")).toContain("BEGIN CERTIFICATE");
    expect(isCertExpired(ROOT_CA_CERT_PATH)).toBe(false);
  });

  it("generates when only rootCA.key exists (partial state)", () => {
    const { ensureRootCASync, ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(tmpDir);

    fs.mkdirSync(path.dirname(ROOT_CA_KEY_PATH), { recursive: true });
    fs.writeFileSync(ROOT_CA_KEY_PATH, "partial-key");

    expect(ensureRootCASync()).toBe(true);
    expect(fs.readFileSync(ROOT_CA_KEY_PATH, "utf8")).toContain("BEGIN RSA PRIVATE KEY");
    expect(fs.existsSync(ROOT_CA_CERT_PATH)).toBe(true);
  });

  it("creates the MITM directory when it does not exist", () => {
    const missingDataDir = path.join(tmpDir, "nested", "data");
    const { ensureRootCASync, ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(missingDataDir);

    expect(fs.existsSync(path.dirname(ROOT_CA_KEY_PATH))).toBe(false);
    expect(ensureRootCASync()).toBe(true);
    expect(fs.existsSync(path.dirname(ROOT_CA_KEY_PATH))).toBe(true);
    expect(fs.existsSync(ROOT_CA_KEY_PATH)).toBe(true);
    expect(fs.existsSync(ROOT_CA_CERT_PATH)).toBe(true);
  });
});
