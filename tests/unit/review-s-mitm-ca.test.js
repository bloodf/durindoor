import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import forge from "node-forge";

const require = createRequire(import.meta.url);
const rootCAPath = require.resolve("../../src/mitm/cert/rootCA.js");
const pathsPath = require.resolve("../../src/mitm/paths.js");
const configPath = require.resolve("../../src/mitm/config.js");
const managerPath = require.resolve("../../src/mitm/manager.js");

function loadRootCAWithDataDir(dataDir) {
  delete require.cache[rootCAPath];
  delete require.cache[pathsPath];
  delete require.cache[configPath];

  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    return require("../../src/mitm/cert/rootCA.js");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}

function cacheModule(modulePath, exports, restorers) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  restorers.push(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

describe("review-s-mitm-ca (#2274)", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-review-mitm-ca-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete require.cache[rootCAPath];
    delete require.cache[pathsPath];
    delete require.cache[configPath];
    delete require.cache[managerPath];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("issues a name-constrained Root CA with 2-year validity and a random 16-byte serial", () => {
    const {
      ensureRootCASync,
      ROOT_CA_CERT_PATH,
      NAME_CONSTRAINTS_OID,
      ROOT_CA_VALIDITY_YEARS,
    } = loadRootCAWithDataDir(tmpDir);
    const { TARGET_HOSTS } = require("../../src/mitm/config.js");

    expect(ensureRootCASync()).toBe(true);
    const cert = forge.pki.certificateFromPem(fs.readFileSync(ROOT_CA_CERT_PATH, "utf8"));
    const nc = cert.getExtension({ id: NAME_CONSTRAINTS_OID });

    expect(nc).toBeTruthy();
    expect(nc.critical).toBe(true);
    const permitted = (nc.permittedSubtrees || [])
      .filter((subtree) => subtree.type === 2)
      .map((subtree) => subtree.value.toLowerCase())
      .sort();
    expect(permitted).toEqual([...TARGET_HOSTS].map((host) => host.toLowerCase()).sort());

    const serialHex = String(cert.serialNumber);
    expect(serialHex).not.toMatch(/^0*1$/);
    expect(serialHex.length).toBeGreaterThanOrEqual(30);
    expect(serialHex.length).toBeLessThanOrEqual(32);
    const serialBytes = Buffer.from(serialHex.padStart(32, "0"), "hex");
    expect(serialBytes.length).toBe(16);
    expect(serialBytes[0] & 0x80).toBe(0);

    const ms = cert.validity.notAfter.getTime() - cert.validity.notBefore.getTime();
    const years = ms / (365.25 * 24 * 60 * 60 * 1000);
    expect(years).toBeGreaterThan(ROOT_CA_VALIDITY_YEARS - 0.02);
    expect(years).toBeLessThan(ROOT_CA_VALIDITY_YEARS + 0.05);
  });

  it("rejects leaf verification for a host outside permittedSubtrees", () => {
    const { createRootCAMaterial, generateLeafCert, NAME_CONSTRAINTS_OID } =
      loadRootCAWithDataDir(tmpDir);
    const { privateKeyPem, certPem } = createRootCAMaterial(["api2.cursor.sh"]);
    const rootKey = forge.pki.privateKeyFromPem(privateKeyPem);
    const rootCert = forge.pki.certificateFromPem(certPem);
    expect(rootCert.getExtension({ id: NAME_CONSTRAINTS_OID })?.critical).toBe(true);

    const rootCA = { key: rootKey, cert: rootCert };
    const okLeafPem = generateLeafCert("api2.cursor.sh", rootCA).cert;
    const badLeafPem = generateLeafCert("deb.debian.org", rootCA).cert;
    const caStore = forge.pki.createCaStore([rootCert]);

    expect(() => {
      forge.pki.verifyCertificateChain(caStore, [forge.pki.certificateFromPem(okLeafPem)]);
    }).not.toThrow();
    expect(() => {
      forge.pki.verifyCertificateChain(caStore, [forge.pki.certificateFromPem(badLeafPem)]);
    }).toThrow(/name constraint/i);
  });

  it("regenerates when an existing constrained CA omits a current MITM target host", () => {
    const rootCA = loadRootCAWithDataDir(tmpDir);
    const { privateKeyPem, certPem } = rootCA.createRootCAMaterial(["api2.cursor.sh"]);
    fs.mkdirSync(path.dirname(rootCA.ROOT_CA_KEY_PATH), { recursive: true, mode: 0o700 });
    fs.writeFileSync(rootCA.ROOT_CA_KEY_PATH, privateKeyPem, { mode: 0o600 });
    fs.writeFileSync(rootCA.ROOT_CA_CERT_PATH, certPem, { mode: 0o644 });

    expect(rootCA.hasValidRootCA()).toBe(false);
    expect(rootCA.ensureRootCASync()).toBe(true);
    expect(rootCA.rootCACoversTargetHosts(rootCA.ROOT_CA_CERT_PATH)).toBe(true);
  });

  it("removes system trust when MITM is disabled, not on process-only stop", async () => {
    const restorers = [];
    const dataDir = path.join(tmpDir, "data");
    const mitmDir = path.join(dataDir, "mitm");
    fs.mkdirSync(mitmDir, { recursive: true });
    fs.writeFileSync(path.join(mitmDir, "rootCA.crt"), "fixture-cert");
    fs.writeFileSync(path.join(mitmDir, "rootCA.key"), "fixture-key");

    const uninstallCert = vi.fn(async () => {});
    const log = vi.fn();
    const err = vi.fn();

    cacheModule("../../src/mitm/paths.js", { DATA_DIR: dataDir, MITM_DIR: mitmDir }, restorers);
    cacheModule("../../src/mitm/logger.js", { log, err }, restorers);
    cacheModule("../../src/mitm/config.js", {
      MITM_ENTRY_ARG: "--durindoor-mitm-entry",
      MITM_START_LOCK_PORT: 20443,
      MITM_NODE_PORT: 8443,
    }, restorers);
    cacheModule("../../src/mitm/serverBootstrap.js", {
      withRootCALock: async (fn) => fn(),
    }, restorers);
    cacheModule("../../src/mitm/processIdentity.js", {
      getProcessStartIdentity: () => null,
    }, restorers);
    cacheModule("../../src/mitm/winElevated.js", {
      isAdmin: () => false,
      runElevatedPowerShell: vi.fn(),
    }, restorers);
    cacheModule("../../src/mitm/cert/rootCA.js", {
      ensureRootCASync: () => false,
      hasValidRootCA: () => true,
    }, restorers);
    cacheModule("../../src/mitm/cert/install.js", {
      assertDurinDoorRootCertificate: vi.fn(),
      installCert: vi.fn(),
      uninstallCert,
      checkCertInstalled: vi.fn(async () => true),
    }, restorers);
    cacheModule("../../src/mitm/dns/dnsConfig.js", {
      addDNSEntry: vi.fn(),
      adoptLegacyDNSEntries: vi.fn(),
      removeDNSEntry: vi.fn(),
      removeAllDNSEntries: vi.fn(async () => {}),
      removeAllDNSEntriesSync: vi.fn(),
      removeLegacyDNSEntries: vi.fn(),
      checkAllDNSStatus: () => ({}),
      TOOL_HOSTS: {},
      isSudoAvailable: () => true,
      isSudoPasswordRequired: () => true,
      execWithPassword: vi.fn(),
    }, restorers);

    const originalSpawn = childProcess.spawn;
    childProcess.spawn = vi.fn(() => {
      const child = new EventEmitter();
      child.pid = 1;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { write: vi.fn(), end: vi.fn() };
      child.kill = vi.fn();
      return child;
    });
    restorers.push(() => {
      childProcess.spawn = originalSpawn;
    });

    delete require.cache[managerPath];
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(async () => ({}), async () => {});
    manager.setCachedPassword("cached-sudo");

    await expect(manager.stopServer(null, { preserveDesiredState: true })).resolves.toEqual({
      running: false,
      pid: null,
    });
    expect(uninstallCert).not.toHaveBeenCalled();

    manager.setCachedPassword("cached-sudo");
    await expect(manager.stopServer(null, { preserveDesiredState: false })).resolves.toEqual({
      running: false,
      pid: null,
    });
    expect(uninstallCert).toHaveBeenCalledTimes(1);
    expect(uninstallCert.mock.calls[0][0]).toBe("cached-sudo");
    expect(uninstallCert.mock.calls[0][1]).toBe(path.join(mitmDir, "rootCA.crt"));

    for (const restore of restorers.reverse()) restore();
  });

  it("warns and continues when disable has no cached sudo password", async () => {
    const restorers = [];
    const dataDir = path.join(tmpDir, "data-nopw");
    const mitmDir = path.join(dataDir, "mitm");
    fs.mkdirSync(mitmDir, { recursive: true });
    fs.writeFileSync(path.join(mitmDir, "rootCA.crt"), "fixture-cert");

    const uninstallCert = vi.fn(async () => {});
    const log = vi.fn();
    const err = vi.fn();

    cacheModule("../../src/mitm/paths.js", { DATA_DIR: dataDir, MITM_DIR: mitmDir }, restorers);
    cacheModule("../../src/mitm/logger.js", { log, err }, restorers);
    cacheModule("../../src/mitm/config.js", {
      MITM_ENTRY_ARG: "--durindoor-mitm-entry",
      MITM_START_LOCK_PORT: 20443,
      MITM_NODE_PORT: 8443,
    }, restorers);
    cacheModule("../../src/mitm/serverBootstrap.js", {
      withRootCALock: async (fn) => fn(),
    }, restorers);
    cacheModule("../../src/mitm/processIdentity.js", {
      getProcessStartIdentity: () => null,
    }, restorers);
    cacheModule("../../src/mitm/winElevated.js", {
      isAdmin: () => false,
      runElevatedPowerShell: vi.fn(),
    }, restorers);
    cacheModule("../../src/mitm/cert/rootCA.js", {
      ensureRootCASync: () => false,
      hasValidRootCA: () => true,
    }, restorers);
    cacheModule("../../src/mitm/cert/install.js", {
      assertDurinDoorRootCertificate: vi.fn(),
      installCert: vi.fn(),
      uninstallCert,
      checkCertInstalled: vi.fn(async () => true),
    }, restorers);
    cacheModule("../../src/mitm/dns/dnsConfig.js", {
      addDNSEntry: vi.fn(),
      adoptLegacyDNSEntries: vi.fn(),
      removeDNSEntry: vi.fn(),
      removeAllDNSEntries: vi.fn(async () => {}),
      removeAllDNSEntriesSync: vi.fn(),
      removeLegacyDNSEntries: vi.fn(),
      checkAllDNSStatus: () => ({}),
      TOOL_HOSTS: {},
      isSudoAvailable: () => true,
      isSudoPasswordRequired: () => true,
      execWithPassword: vi.fn(),
    }, restorers);

    delete require.cache[managerPath];
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(async () => ({}), async () => {});
    manager.setCachedPassword(null);

    await expect(manager.stopServer(null)).resolves.toEqual({ running: false, pid: null });
    expect(uninstallCert).toHaveBeenCalledTimes(1);
    expect(uninstallCert.mock.calls[0][0]).toBeNull();
    expect(log.mock.calls.some(([msg]) => /no cached sudo password/i.test(String(msg)))).toBe(true);

    for (const restore of restorers.reverse()) restore();
  });
});
