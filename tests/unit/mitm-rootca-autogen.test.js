import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

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
    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(ROOT_CA_KEY_PATH)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(ROOT_CA_KEY_PATH).mode & 0o777).toBe(0o600);
      expect(fs.statSync(ROOT_CA_CERT_PATH).mode & 0o777).toBe(0o644);
    }
    expect(fs.readdirSync(path.dirname(ROOT_CA_KEY_PATH)).filter((name) => /\.(tmp|bak)$/.test(name))).toEqual([]);
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

  it("generates when only rootCA.crt exists (partial state)", () => {
    const { ensureRootCASync, ROOT_CA_KEY_PATH, ROOT_CA_CERT_PATH } =
      loadRootCAWithDataDir(tmpDir);

    fs.mkdirSync(path.dirname(ROOT_CA_CERT_PATH), { recursive: true });
    fs.writeFileSync(ROOT_CA_CERT_PATH, "partial-cert");

    expect(ensureRootCASync()).toBe(true);
    expect(fs.readFileSync(ROOT_CA_KEY_PATH, "utf8")).toContain("BEGIN RSA PRIVATE KEY");
    expect(fs.readFileSync(ROOT_CA_CERT_PATH, "utf8")).toContain("BEGIN CERTIFICATE");
  });

  it("regenerates a mismatched key and certificate pair", () => {
    const first = loadRootCAWithDataDir(path.join(tmpDir, "first"));
    first.ensureRootCASync();
    const originalKey = fs.readFileSync(first.ROOT_CA_KEY_PATH, "utf8");

    const second = loadRootCAWithDataDir(path.join(tmpDir, "second"));
    second.ensureRootCASync();
    fs.copyFileSync(second.ROOT_CA_CERT_PATH, first.ROOT_CA_CERT_PATH);

    expect(first.hasValidRootCA()).toBe(false);
    expect(first.ensureRootCASync()).toBe(true);
    expect(first.hasValidRootCA()).toBe(true);
    expect(fs.readFileSync(first.ROOT_CA_KEY_PATH, "utf8")).not.toBe(originalKey);
  });

  it("restores the previous pair when publishing replacement files fails", () => {
    const rootCA = loadRootCAWithDataDir(tmpDir);
    rootCA.ensureRootCASync();

    const privateKeyPem = fs.readFileSync(rootCA.ROOT_CA_KEY_PATH, "utf8");
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const expiredCert = forge.pki.certificateFromPem(fs.readFileSync(rootCA.ROOT_CA_CERT_PATH, "utf8"));
    expiredCert.validity.notAfter = new Date(Date.now() - 60_000);
    expiredCert.sign(privateKey, forge.md.sha256.create());
    const expiredCertPem = forge.pki.certificateToPem(expiredCert);
    fs.writeFileSync(rootCA.ROOT_CA_CERT_PATH, expiredCertPem);

    const renameSync = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(from).endsWith(".tmp") && to === rootCA.ROOT_CA_CERT_PATH) {
        throw Object.assign(new Error("injected publish failure"), { code: "EIO" });
      }
      return renameSync(from, to);
    });

    expect(() => rootCA.ensureRootCASync()).toThrow("injected publish failure");
    expect(fs.readFileSync(rootCA.ROOT_CA_KEY_PATH, "utf8")).toBe(privateKeyPem);
    expect(fs.readFileSync(rootCA.ROOT_CA_CERT_PATH, "utf8")).toBe(expiredCertPem);
    expect(fs.readdirSync(path.dirname(rootCA.ROOT_CA_KEY_PATH)).filter((name) => /\.(tmp|bak)$/.test(name))).toEqual([]);
  });

  it("removes the private-key temp when certificate-temp creation fails", () => {
    const rootCA = loadRootCAWithDataDir(tmpDir);
    const openSync = fs.openSync.bind(fs);
    vi.spyOn(fs, "openSync").mockImplementation((filePath, ...args) => {
      if (String(filePath).includes("rootCA.crt.") && String(filePath).endsWith(".tmp")) {
        throw Object.assign(new Error("injected cert-temp failure"), { code: "EIO" });
      }
      return openSync(filePath, ...args);
    });

    expect(() => rootCA.ensureRootCASync()).toThrow("injected cert-temp failure");
    const mitmDir = path.dirname(rootCA.ROOT_CA_KEY_PATH);
    expect(fs.readdirSync(mitmDir).filter((name) => /rootCA\..*\.tmp$/.test(name))).toEqual([]);
    expect(fs.existsSync(rootCA.ROOT_CA_KEY_PATH)).toBe(false);
    expect(fs.existsSync(rootCA.ROOT_CA_CERT_PATH)).toBe(false);
  });

  it("surfaces a backup cleanup failure without discarding the published pair", () => {
    const rootCA = loadRootCAWithDataDir(tmpDir);
    rootCA.ensureRootCASync();
    fs.writeFileSync(rootCA.ROOT_CA_CERT_PATH, "force-replacement");

    const unlinkSync = fs.unlinkSync.bind(fs);
    vi.spyOn(fs, "unlinkSync").mockImplementation((filePath) => {
      if (String(filePath).includes("rootCA.key.") && String(filePath).endsWith(".bak")) {
        throw Object.assign(new Error("injected backup cleanup failure"), { code: "EACCES" });
      }
      return unlinkSync(filePath);
    });

    expect(() => rootCA.ensureRootCASync()).toThrow(/backup file\(s\) could not be removed/);
    expect(rootCA.hasValidRootCA()).toBe(true);
    const keyBackup = fs.readdirSync(path.dirname(rootCA.ROOT_CA_KEY_PATH))
      .find((name) => /^rootCA\.key\..*\.bak$/.test(name));
    expect(keyBackup).toBeTruthy();
    if (process.platform !== "win32") {
      expect(fs.statSync(path.join(path.dirname(rootCA.ROOT_CA_KEY_PATH), keyBackup)).mode & 0o777).toBe(0o600);
    }
  });

  it("recovers a matching pair left in backup files by an interrupted publish", () => {
    const rootCA = loadRootCAWithDataDir(tmpDir);
    rootCA.ensureRootCASync();
    const originalKey = fs.readFileSync(rootCA.ROOT_CA_KEY_PATH, "utf8");
    const originalCert = fs.readFileSync(rootCA.ROOT_CA_CERT_PATH, "utf8");
    const generation = "interrupted.bak";
    fs.renameSync(rootCA.ROOT_CA_KEY_PATH, `${rootCA.ROOT_CA_KEY_PATH}.${generation}`);
    fs.renameSync(rootCA.ROOT_CA_CERT_PATH, `${rootCA.ROOT_CA_CERT_PATH}.${generation}`);

    expect(rootCA.ensureRootCASync()).toBe(false);
    expect(fs.readFileSync(rootCA.ROOT_CA_KEY_PATH, "utf8")).toBe(originalKey);
    expect(fs.readFileSync(rootCA.ROOT_CA_CERT_PATH, "utf8")).toBe(originalCert);
    expect(fs.readdirSync(path.dirname(rootCA.ROOT_CA_KEY_PATH)).filter((name) => /\.(tmp|bak)$/.test(name))).toEqual([]);
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked private-key path", () => {
    const { ensureRootCASync, ROOT_CA_KEY_PATH } = loadRootCAWithDataDir(tmpDir);
    const target = path.join(tmpDir, "outside-key");
    fs.mkdirSync(path.dirname(ROOT_CA_KEY_PATH), { recursive: true });
    fs.writeFileSync(target, "do-not-overwrite");
    fs.symlinkSync(target, ROOT_CA_KEY_PATH);

    expect(() => ensureRootCASync()).toThrow(/Unsafe Root CA path/);
    expect(fs.readFileSync(target, "utf8")).toBe("do-not-overwrite");
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
