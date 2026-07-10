import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const managerPath = require.resolve("../../src/mitm/manager.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
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

function installLifecycleHarness({
  tmpDir,
  restorers,
  healthPid = null,
  launcherPid = 424242,
  launcherAlive = true,
  launcherProbeDenied = false,
  spawnError = null,
  lockReleaseError = null,
  lockContention = false,
  initialNonce = null,
  exitBeforeHealth = false,
  existingRootCA = false,
  rootCAValid = true,
  rootCAGenerationError = null,
  killBarrier = null,
  healthServerNonce = null,
  hangingHealth = false,
  parentIsAdmin = false,
  publicHealthFailure = false,
  internalPortBusy = false,
  uninstallError = null,
  installError = null,
  certInstalled = true,
  redirectInstallError = null,
  redirectRemovalError = null,
  dnsRemovalError = null,
}) {
  const dataDir = path.join(tmpDir, "data");
  const mitmDir = path.join(dataDir, "mitm");
  const commands = [];
  const killedPids = [];
  const alivePids = new Set(Number.isSafeInteger(launcherPid) && launcherAlive ? [launcherPid] : []);
  const processStartFor = (pid) => `fixture-start-${pid}`;
  const launcherStart = processStartFor(launcherPid);
  if (healthPid) alivePids.add(healthPid);
  let instanceNonce = initialNonce;

  if (existingRootCA) {
    fs.mkdirSync(mitmDir, { recursive: true });
    fs.writeFileSync(path.join(mitmDir, "rootCA.crt"), "existing-cert");
    if (existingRootCA !== "cert-only") {
      fs.writeFileSync(path.join(mitmDir, "rootCA.key"), "existing-key");
    }
  }

  cacheModule("../../src/mitm/paths.js", { DATA_DIR: dataDir, MITM_DIR: mitmDir }, restorers);
  cacheModule("../../src/mitm/logger.js", { log: vi.fn(), err: vi.fn() }, restorers);
  cacheModule("../../src/mitm/config.js", {
    LSOF_BIN: "lsof",
    MITM_ENTRY_ARG: "--durindoor-mitm-entry",
    MITM_START_LOCK_PORT: 20443,
    MITM_NODE_PORT: 8443,
  }, restorers);
  cacheModule("../../src/mitm/serverBootstrap.js", {
    withRootCALock: async (operation) => operation(),
  }, restorers);
  cacheModule("../../src/mitm/processIdentity.js", {
    getProcessStartIdentity: (pid) => alivePids.has(pid) ? processStartFor(pid) : null,
  }, restorers);
  cacheModule("../../src/mitm/winElevated.js", {
    isAdmin: () => parentIsAdmin,
    runElevatedPowerShell: vi.fn(),
  }, restorers);
  const ensureRootCASync = vi.fn(() => {
    if (rootCAGenerationError) throw rootCAGenerationError;
    if (!rootCAValid) {
      fs.writeFileSync(path.join(mitmDir, "rootCA.key"), "generated-key");
      fs.writeFileSync(path.join(mitmDir, "rootCA.crt"), "generated-cert");
      return true;
    }
    return false;
  });
  cacheModule("../../src/mitm/cert/rootCA.js", {
    ensureRootCASync,
    hasValidRootCA: () => rootCAValid,
  }, restorers);
  const uninstallCert = vi.fn(async () => {
    if (uninstallError) throw uninstallError;
  });
  let trusted = certInstalled;
  const installCert = vi.fn(async () => {
    if (installError) throw installError;
    trusted = true;
  });
  cacheModule("../../src/mitm/cert/install.js", {
    assertDurinDoorRootCertificate: vi.fn((certPath) => {
      if (fs.readFileSync(certPath, "utf8") === "corrupt-cert") {
        throw new Error("invalid certificate bytes");
      }
      return { cert: {} };
    }),
    installCert,
    uninstallCert,
    checkCertInstalled: vi.fn(() => trusted),
  }, restorers);
  const execWithPassword = vi.fn((command, _password, metadata = {}) => {
    commands.push(command);
    const isRedirectRemoval = metadata.scope === "mitm-port-redirect"
      ? metadata.operation === "remove"
      : command.includes("-F all") || command.includes("-D OUTPUT");
    if (redirectInstallError && !isRedirectRemoval) {
      return Promise.reject(redirectInstallError);
    }
    if (redirectRemovalError && isRedirectRemoval) {
      return Promise.reject(redirectRemovalError);
    }
    const completeKill = () => {
      for (const pid of alivePids) {
        if (command.includes(String(pid))) alivePids.delete(pid);
      }
      if (command.includes(`-P ${launcherPid}`)) alivePids.clear();
    };
    if (killBarrier && (/\bkill\b|\bpkill\b/.test(command) || isRedirectRemoval)) {
      return killBarrier.promise.then(completeKill);
    }
    completeKill();
    return Promise.resolve();
  });
  const removeAllDNSEntries = vi.fn(async () => {
    if (dnsRemovalError) throw dnsRemovalError;
  });
  const removeLegacyDNSEntries = vi.fn();
  cacheModule("../../src/mitm/dns/dnsConfig.js", {
    addDNSEntry: vi.fn(),
    adoptLegacyDNSEntries: vi.fn(),
    removeDNSEntry: vi.fn(),
    removeAllDNSEntries,
    removeAllDNSEntriesSync: vi.fn(),
    removeLegacyDNSEntries,
    checkAllDNSStatus: () => ({}),
    TOOL_HOSTS: {},
    isSudoAvailable: () => true,
    isSudoPasswordRequired: () => false,
    execWithPassword,
  }, restorers);

  const child = new EventEmitter();
  child.pid = launcherPid;
  child.killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { write: vi.fn(), end: vi.fn() };
  child.kill = vi.fn(() => {
    child.killed = true;
    alivePids.delete(launcherPid);
    return true;
  });

  const originalExec = childProcess.exec;
  const originalExecFile = childProcess.execFile;
  const originalExecFileSync = childProcess.execFileSync;
  const originalExecSync = childProcess.execSync;
  const originalSpawn = childProcess.spawn;
  childProcess.exec = vi.fn((command, options, callback) => {
    if (typeof options === "function") options(null, "", "");
    else callback?.(null, "", "");
    return { on: vi.fn() };
  });
  childProcess.execFile = vi.fn((command, args, options, callback) => {
    const complete = () => callback?.(null, "", "");
    if (killBarrier && String(command).endsWith("pkill")) {
      void killBarrier.promise.then(complete);
    } else {
      complete();
    }
    return { on: vi.fn() };
  });
  childProcess.execFileSync = vi.fn((command, args) => {
    if (args?.includes("lstart=")) return `${launcherStart}\n`;
    throw new Error("no port owner");
  });
  childProcess.execSync = vi.fn((command) => {
    if (String(command).includes(" lstart=")) return `${launcherStart}\n`;
    throw new Error("no port owner");
  });
  childProcess.spawn = vi.fn((command, args, options) => {
    const bootstrapIndex = args?.indexOf("--durindoor-mitm-bootstrap") ?? -1;
    if (bootstrapIndex >= 0) {
      const bootstrap = JSON.parse(fs.readFileSync(args[bootstrapIndex + 1], "utf8"));
      instanceNonce = bootstrap.nonce;
    } else {
      instanceNonce = options?.env?.MITM_INSTANCE_NONCE || instanceNonce;
    }
    if (spawnError) queueMicrotask(() => child.emit("error", spawnError));
    return child;
  });
  restorers.push(() => {
    childProcess.exec = originalExec;
    childProcess.execFile = originalExecFile;
    childProcess.execFileSync = originalExecFileSync;
    childProcess.execSync = originalExecSync;
    childProcess.spawn = originalSpawn;
  });

  const originalCreateServer = net.createServer;
  let serverCount = 0;
  net.createServer = vi.fn(() => {
    serverCount += 1;
    const serverId = serverCount;
    const callbacks = {};
    return {
      once(event, callback) { callbacks[event] = callback; return this; },
      on() { return this; },
      removeListener() { return this; },
      unref() { return this; },
      listen(...args) {
        if (serverId === 1 && lockContention) {
          callbacks.error?.(Object.assign(new Error("address in use"), { code: "EADDRINUSE" }));
          return;
        }
        if (serverId === 2 && internalPortBusy) {
          callbacks.error?.(Object.assign(new Error("address in use"), { code: "EADDRINUSE" }));
          return;
        }
        const callback = args.at(-1);
        if (typeof callback === "function") callback();
        else callbacks.listening?.();
      },
      close(callback) {
        callback?.(serverId === 1 ? lockReleaseError : null);
      },
    };
  });
  restorers.push(() => { net.createServer = originalCreateServer; });

  const originalRequest = https.request;
  https.request = vi.fn((options, callback) => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = (error) => request.emit("error", error);
    if (hangingHealth) {
      request.end = vi.fn();
      return request;
    }
    request.end = () => queueMicrotask(() => {
      if (exitBeforeHealth) child.emit("exit", 1);
      const response = new EventEmitter();
      callback(response);
      const challenge = options.headers?.["x-durindoor-mitm-challenge"];
      const healthNonce = healthServerNonce || instanceNonce;
      const proof = challenge && healthNonce
        ? crypto.createHmac("sha256", healthNonce).update(challenge).digest("hex")
        : undefined;
      const healthAvailable = healthPid && !(publicHealthFailure && options.port === 443);
      response.emit("data", JSON.stringify(healthAvailable
        ? { ok: true, pid: healthPid, proof }
        : { ok: false }));
      response.emit("end");
    });
    return request;
  });
  restorers.push(() => { https.request = originalRequest; });

  const originalKill = process.kill;
  process.kill = vi.fn((pid, signal) => {
    if (signal === 0 && launcherProbeDenied && pid === launcherPid) {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    }
    if (signal === 0 && alivePids.has(pid)) return true;
    if (signal !== 0 && alivePids.has(pid)) {
      alivePids.delete(pid);
      killedPids.push(pid);
      return true;
    }
    throw Object.assign(new Error("not alive"), { code: "ESRCH" });
  });
  restorers.push(() => { process.kill = originalKill; });

  return {
    child,
    commands,
    ensureRootCASync,
    installCert,
    get instanceNonce() { return instanceNonce; },
    launcherStart,
    killedPids,
    processStartFor,
    mitmDir,
    removeAllDNSEntries,
    removeLegacyDNSEntries,
    uninstallCert,
  };
}

describe("MITM manager startup coordination", () => {
  let tmpDir;
  let restorers;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-manager-"));
    process.env.MITM_GLOBAL_STATE_DIR = path.join(tmpDir, "global-state");
    restorers = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    delete require.cache[managerPath];
    for (const restore of restorers.reverse()) restore();
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.MITM_GLOBAL_STATE_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("rejects a concurrent start, releases its owned lock on failure, and permits retry", async () => {
    const dataDir = path.join(tmpDir, "data");
    const mitmDir = path.join(dataDir, "mitm");
    const firstGeneration = deferred();
    const ensureRootCASync = vi.fn()
      .mockImplementationOnce(() => firstGeneration.promise)
      .mockRejectedValue(new Error("retry reached certificate generation"));

    cacheModule("../../src/mitm/paths.js", { DATA_DIR: dataDir, MITM_DIR: mitmDir }, restorers);
    cacheModule("../../src/mitm/logger.js", { log: vi.fn(), err: vi.fn() }, restorers);
    cacheModule("../../src/mitm/config.js", {
      LSOF_BIN: "lsof",
      MITM_ENTRY_ARG: "--durindoor-mitm-entry",
      MITM_START_LOCK_PORT: 20443,
      MITM_NODE_PORT: 8443,
    }, restorers);
    cacheModule("../../src/mitm/serverBootstrap.js", {
      withRootCALock: async (operation) => operation(),
    }, restorers);
    cacheModule("../../src/mitm/winElevated.js", { isAdmin: () => false }, restorers);
    cacheModule("../../src/mitm/cert/rootCA.js", {
      ensureRootCASync,
      hasValidRootCA: () => false,
    }, restorers);
    cacheModule("../../src/mitm/cert/install.js", {
      installCert: vi.fn(),
      uninstallCert: vi.fn(),
      checkCertInstalled: vi.fn(() => false),
    }, restorers);
    cacheModule("../../src/mitm/dns/dnsConfig.js", {
      addDNSEntry: vi.fn(),
      adoptLegacyDNSEntries: vi.fn(),
      removeDNSEntry: vi.fn(),
      removeAllDNSEntries: vi.fn(),
      removeAllDNSEntriesSync: vi.fn(),
      removeLegacyDNSEntries: vi.fn(),
      checkAllDNSStatus: () => ({}),
      TOOL_HOSTS: {},
      isSudoAvailable: () => true,
      isSudoPasswordRequired: () => false,
      execWithPassword: vi.fn(() => Promise.resolve()),
    }, restorers);

    const originalExec = childProcess.exec;
    const originalExecSync = childProcess.execSync;
    const originalSpawn = childProcess.spawn;
    childProcess.exec = vi.fn((command, options, callback) => {
      if (typeof options === "function") options(null, "", "");
      else callback?.(null, "", "");
      return { on: vi.fn() };
    });
    childProcess.execSync = vi.fn();
    childProcess.spawn = vi.fn(() => { throw new Error("spawn must not be reached"); });
    restorers.push(() => {
      childProcess.exec = originalExec;
      childProcess.execSync = originalExecSync;
      childProcess.spawn = originalSpawn;
    });

    const originalCreateServer = net.createServer;
    net.createServer = vi.fn(() => {
      const callbacks = {};
      return {
        once(event, callback) { callbacks[event] = callback; return this; },
        on() { return this; },
        removeListener() { return this; },
        unref() { return this; },
        listen(...args) {
          const callback = args.at(-1);
          if (typeof callback === "function") callback();
          else callbacks.listening?.();
        },
        close(callback) { callback?.(); },
      };
    });
    restorers.push(() => { net.createServer = originalCreateServer; });

    const { startServer } = require("../../src/mitm/manager.js");
    const first = startServer("fixture-key", "fixture-password");
    await vi.advanceTimersByTimeAsync(500);
    expect(ensureRootCASync).toHaveBeenCalledTimes(1);

    await expect(startServer("other-key", "other-password")).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });

    firstGeneration.reject(new Error("first generation failed"));
    await expect(first).rejects.toThrow("first generation failed");
    expect(fs.existsSync(path.join(mitmDir, ".mitm.pid"))).toBe(false);

    const retry = startServer("fixture-key", "fixture-password");
    const retryFailure = expect(retry).rejects.toThrow("retry reached certificate generation");
    await vi.advanceTimersByTimeAsync(500);
    await retryFailure;
    expect(ensureRootCASync).toHaveBeenCalledTimes(2);
    expect(fs.existsSync(path.join(mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("does not remove another DATA_DIR instance's global rule when its transport is live", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers, internalPortBusy: true });
    const globalDir = path.join(tmpDir, "global-state");
    fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(globalDir, "redirect.json"), `${JSON.stringify({
      version: 1,
      state: "installed",
      ownerKind: "uid",
      ownerValue: String(process.geteuid?.() ?? process.getuid()),
      publicPort: 443,
      internalPort: 8443,
      nonce: "c".repeat(48),
    })}\n`, { mode: 0o600 });

    const { startServer } = require("../../src/mitm/manager.js");
    await expect(startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_INTERNAL_PORT_BUSY",
    });
    expect(harness.removeAllDNSEntries).not.toHaveBeenCalled();
    expect(harness.commands.some((command) => command.includes("-F all") || command.includes("-D OUTPUT"))).toBe(false);
    expect(fs.existsSync(path.join(globalDir, "redirect.json"))).toBe(true);
  });

  it("refuses a cross-DATA_DIR stop when only a global journal and live incumbent exist", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers, internalPortBusy: true });
    const globalDir = path.join(tmpDir, "global-state");
    fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(globalDir, "redirect.json"), `${JSON.stringify({
      version: 1,
      state: "installed",
      ownerKind: "uid",
      ownerValue: String(process.geteuid?.() ?? process.getuid()),
      publicPort: 443,
      internalPort: 8443,
      nonce: "d".repeat(48),
    })}\n`, { mode: 0o600 });

    const { stopServer } = require("../../src/mitm/manager.js");
    await expect(stopServer("fixture-password")).rejects.toMatchObject({
      code: "MITM_OWNERSHIP_UNVERIFIED",
    });
    expect(harness.removeAllDNSEntries).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(globalDir, "redirect.json"))).toBe(true);
  });

  it("quarantines an unconfirmed privileged redirect mutation and refuses inverse cleanup", async () => {
    const redirectInstallError = Object.assign(new Error("privileged wrapper timed out"), {
      code: "PRIVILEGED_TERMINATION_UNCONFIRMED",
    });
    const harness = installLifecycleHarness({ tmpDir, restorers, redirectInstallError });
    const manager = require("../../src/mitm/manager.js");

    await expect(manager.startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_PRIVILEGED_OPERATION_UNCERTAIN",
    });
    const journalPath = path.join(tmpDir, "global-state", "redirect.json");
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ state: "uncertain" });
    const commandCount = harness.commands.length;

    await expect(manager.stopServer("fixture-password")).rejects.toMatchObject({
      code: "MITM_PRIVILEGED_OPERATION_UNCERTAIN",
    });
    expect(harness.commands).toHaveLength(commandCount);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ state: "uncertain" });
  });

  it("quarantines a crash-residue installing journal before dispatching a mutation", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers });
    const globalDir = path.join(tmpDir, "global-state");
    fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 });
    const journalPath = path.join(globalDir, "redirect.json");
    fs.writeFileSync(journalPath, `${JSON.stringify({
      version: 1,
      state: "installing",
      ownerKind: "uid",
      ownerValue: String(process.geteuid?.() ?? process.getuid()),
      publicPort: 443,
      internalPort: 8443,
      nonce: "e".repeat(48),
    })}\n`, { mode: 0o600 });

    const { startServer } = require("../../src/mitm/manager.js");
    await expect(startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_PRIVILEGED_OPERATION_UNCERTAIN",
    });
    expect(harness.commands).toEqual([]);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ state: "uncertain" });
  });

  it("quarantines a crash-residue installing journal on direct stop", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers });
    const globalDir = path.join(tmpDir, "global-state");
    fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 });
    const journalPath = path.join(globalDir, "redirect.json");
    fs.writeFileSync(journalPath, `${JSON.stringify({
      version: 1,
      state: "installing",
      ownerKind: "uid",
      ownerValue: String(process.geteuid?.() ?? process.getuid()),
      publicPort: 443,
      internalPort: 8443,
      nonce: "f".repeat(48),
    })}\n`, { mode: 0o600 });

    const { stopServer } = require("../../src/mitm/manager.js");
    await expect(stopServer("fixture-password")).rejects.toMatchObject({
      code: "MITM_PRIVILEGED_OPERATION_UNCERTAIN",
    });
    expect(harness.commands).toEqual([]);
    expect(JSON.parse(fs.readFileSync(journalPath, "utf8"))).toMatchObject({ state: "uncertain" });
  });

  it("reverses a confirmed redirect-install failure before deleting its journal", async () => {
    const redirectInstallError = new Error("confirmed PF install failure");
    const harness = installLifecycleHarness({ tmpDir, restorers, redirectInstallError });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toBe(redirectInstallError);
    expect(harness.commands.some((command) => command.includes("-F all") || command.includes("-D OUTPUT"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "global-state", "redirect.json"))).toBe(false);
  });

  it("rolls back the launcher and owned PID record after health failure", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers, healthPid: null });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = startServer("fixture-key", "fixture-password");
    const failure = expect(start).rejects.toThrow("MITM server failed to start");

    await vi.advanceTimersByTimeAsync(250);
    await failure;

    expect(harness.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("rejects a health response that cannot prove knowledge of the instance nonce", async () => {
    const healthPid = 535354;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      healthServerNonce: "d".repeat(48),
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "MITM server failed to start",
    );

    await vi.runAllTimersAsync();
    await start;
    expect(harness.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("bounds a health peer that never ends its response", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers, hangingHealth: true });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "MITM server failed to start",
    );

    await vi.runAllTimersAsync();
    await start;
    expect(https.request).toHaveBeenCalled();
    expect(harness.child.kill).toHaveBeenCalled();
  });

  it("rolls back when the authenticated public-port redirect is ineffective", async () => {
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid: 535355,
      publicHealthFailure: true,
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "MITM server failed to start",
    );

    await vi.runAllTimersAsync();
    await start;
    expect(harness.child.kill).toHaveBeenCalled();
    expect(harness.commands.some((command) => command.includes("-F all") || command.includes("-D OUTPUT"))).toBe(true);
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("keeps the operation gate held until privileged redirect rollback completes", async () => {
    const killBarrier = deferred();
    const harness = installLifecycleHarness({ tmpDir, restorers, healthPid: null, killBarrier });
    const { startServer } = require("../../src/mitm/manager.js");
    const first = startServer("fixture-key", "fixture-password");
    const firstFailure = expect(first).rejects.toThrow("MITM server failed to start");
    await vi.advanceTimersByTimeAsync(50);

    await expect(startServer("other-key", "other-password")).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(true);

    killBarrier.resolve();
    await vi.runAllTimersAsync();
    await firstFailure;
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("retains PID ownership metadata when redirect rollback fails", async () => {
    const redirectError = new Error("injected PF anchor removal failure");
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid: null,
      redirectRemovalError: redirectError,
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = startServer("fixture-key", "fixture-password");
    const failure = expect(start).rejects.toMatchObject({ cleanupError: redirectError });

    await vi.runAllTimersAsync();
    await failure;
    expect(harness.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(true);
  });

  it("keeps the previous trust entry when Root CA replacement generation fails", async () => {
    const generationError = new Error("injected Root CA generation failure");
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      existingRootCA: true,
      rootCAValid: false,
      rootCAGenerationError: generationError,
    });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toBe(generationError);

    expect(harness.uninstallCert).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(harness.mitmDir, "rootCA.key"), "utf8")).toBe("existing-key");
    expect(fs.readFileSync(path.join(harness.mitmDir, "rootCA.crt"), "utf8")).toBe("existing-cert");
    expect(fs.readdirSync(harness.mitmDir).some((name) => name.startsWith(".rootCA.previous."))).toBe(false);
  });

  it("uninstalls a cert-only stale trust entry after successful replacement", async () => {
    const healthPid = 545454;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      existingRootCA: "cert-only",
      rootCAValid: false,
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toMatchObject({
      running: true,
      pid: healthPid,
    });
    await vi.runAllTimersAsync();
    await start;

    expect(harness.uninstallCert).toHaveBeenCalledTimes(1);
    expect(harness.uninstallCert.mock.calls[0][1]).toContain(".rootCA.previous.");
    expect(fs.readFileSync(path.join(harness.mitmDir, "rootCA.crt"), "utf8")).toBe("generated-cert");
  });

  it("retains the previous trust journal when replacement trust installation fails", async () => {
    const installError = new Error("injected replacement trust failure");
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      existingRootCA: true,
      rootCAValid: false,
      certInstalled: false,
      installError,
    });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      `Failed to trust certificate: ${installError.message}`,
    );

    expect(harness.installCert).toHaveBeenCalledTimes(1);
    expect(harness.uninstallCert).not.toHaveBeenCalled();
    const journals = fs.readdirSync(harness.mitmDir)
      .filter((name) => name.startsWith(".rootCA.previous."));
    expect(journals).toHaveLength(1);
    expect(fs.readFileSync(path.join(harness.mitmDir, journals[0]), "utf8")).toBe("existing-cert");
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("regenerates a corrupt Root CA without journaling it as a trust entry", async () => {
    const healthPid = 565656;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      existingRootCA: true,
      rootCAValid: false,
    });
    fs.writeFileSync(path.join(harness.mitmDir, "rootCA.crt"), "corrupt-cert");
    const { startServer } = require("../../src/mitm/manager.js");

    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toMatchObject({
      running: true,
      pid: healthPid,
    });
    await vi.runAllTimersAsync();
    await start;

    expect(harness.uninstallCert).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(harness.mitmDir, "rootCA.crt"), "utf8")).toBe("generated-cert");
    expect(fs.readdirSync(harness.mitmDir).some((name) => name.startsWith(".rootCA.previous."))).toBe(false);
  });

  it("retains a trust-rotation journal when old-certificate removal fails", async () => {
    const uninstallError = new Error("injected trust-store removal failure");
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      existingRootCA: true,
      rootCAValid: false,
      uninstallError,
    });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toBe(uninstallError);
    const journals = fs.readdirSync(harness.mitmDir)
      .filter((name) => name.startsWith(".rootCA.previous."));
    expect(journals).toHaveLength(1);
    expect(fs.readFileSync(path.join(harness.mitmDir, journals[0]), "utf8")).toBe("existing-cert");
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("acquires the cross-process gate before reusing a healthy PID record", async () => {
    const healthPid = 556677;
    const nonce = "a".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      launcherPid: healthPid,
      lockContention: true,
      initialNonce: nonce,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid: healthPid,
      launcherPid: healthPid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
      processStart: harness.processStartFor(healthPid),
    })}\n`);

    const { startServer } = require("../../src/mitm/manager.js");
    await expect(startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_START_IN_PROGRESS",
    });

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(pidPath)).toBe(true);
  });

  it("removes malformed regular PID metadata under the gate before publishing", async () => {
    const healthPid = 565656;
    const harness = installLifecycleHarness({ tmpDir, restorers, healthPid });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.writeFileSync(pidPath, "malformed-pid-record\n");

    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toEqual({
      running: true,
      pid: healthPid,
    });
    await vi.runAllTimersAsync();
    await start;

    expect(JSON.parse(fs.readFileSync(pidPath, "utf8"))).toMatchObject({
      version: 1,
      pid: healthPid,
      nonce: harness.instanceNonce,
      state: "running",
    });
  });

  it("keeps starting PID metadata when a concurrent status read is not yet healthy", async () => {
    const launcherPid = 585858;
    const nonce = "b".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid,
      initialNonce: nonce,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    const startingRecord = {
      version: 1,
      pid: launcherPid,
      launcherPid,
      nonce,
      state: "starting",
      launcherStart: harness.launcherStart,
    };
    fs.writeFileSync(pidPath, `${JSON.stringify(startingRecord)}\n`);

    const { getMitmStatus } = require("../../src/mitm/manager.js");
    await expect(getMitmStatus()).resolves.toMatchObject({ running: false, pid: null });
    expect(JSON.parse(fs.readFileSync(pidPath, "utf8"))).toEqual(startingRecord);
  });

  it("promotes a nonce-authenticated unprivileged child after its launcher manager crashes", async () => {
    const launcherPid = 595959;
    const healthPid = 606060;
    const nonce = "c".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid,
      healthPid,
      initialNonce: nonce,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid: launcherPid,
      launcherPid,
      nonce,
      state: "starting",
      launcherStart: harness.launcherStart,
    })}\n`);

    const { startServer } = require("../../src/mitm/manager.js");
    await expect(startServer("fixture-key", "fixture-password")).resolves.toEqual({
      running: true,
      pid: healthPid,
    });

    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(pidPath, "utf8"))).toEqual({
      version: 1,
      pid: healthPid,
      launcherPid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
      processStart: harness.processStartFor(healthPid),
    });
  });

  it("reports a v1 process stopped when its authenticated public redirect is unavailable", async () => {
    const healthPid = 606061;
    const nonce = "f".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: healthPid,
      healthPid,
      initialNonce: nonce,
      publicHealthFailure: true,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    fs.writeFileSync(path.join(harness.mitmDir, ".mitm.pid"), `${JSON.stringify({
      version: 1,
      pid: healthPid,
      launcherPid: healthPid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
    })}\n`);

    const { getMitmStatus } = require("../../src/mitm/manager.js");
    await expect(getMitmStatus()).resolves.toMatchObject({ running: false, pid: null });
    expect(https.request.mock.calls.map(([options]) => options.port)).toEqual([8443, 443]);
  });

  it("rejects reuse when public redirect verification fails and preserves the live PID record", async () => {
    const healthPid = 606062;
    const nonce = "1".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: healthPid,
      healthPid,
      initialNonce: nonce,
      publicHealthFailure: true,
    });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid: healthPid,
      launcherPid: healthPid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
    })}\n`);
    const updateSettings = vi.fn();
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(async () => ({}), updateSettings);

    await expect(manager.startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_REDIRECT_UNHEALTHY",
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(harness.commands.some((command) => command.includes("-F all") || command.includes("-D OUTPUT"))).toBe(true);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("preserves a live PID record whose process ownership cannot be authenticated", async () => {
    const pid = 606063;
    const nonce = "2".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: pid,
      healthPid: pid,
      initialNonce: nonce,
      healthServerNonce: "3".repeat(48),
    });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid,
      launcherPid: pid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
    })}\n`);
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_OWNERSHIP_UNVERIFIED",
    });
    expect(fs.existsSync(pidPath)).toBe(true);
    expect(harness.commands).toEqual([]);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("removes a dead v1 redirect and PID before later certificate work fails", async () => {
    const pid = 606064;
    const nonce = "4".repeat(48);
    const generationError = new Error("injected CA failure after stale cleanup");
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: pid,
      launcherAlive: false,
      initialNonce: nonce,
      rootCAValid: false,
      rootCAGenerationError: generationError,
    });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid,
      launcherPid: pid,
      nonce,
      state: "running",
      launcherStart: harness.launcherStart,
    })}\n`);
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toBe(generationError);
    expect(harness.commands.some((command) => command.includes("-F all") || command.includes("-D OUTPUT"))).toBe(true);
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it("handles an asynchronous spawn error before rejecting a missing PID", async () => {
    const spawnError = Object.assign(new Error("sudo not found"), { code: "ENOENT" });
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: null,
      spawnError,
    });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "MITM server process failed to spawn",
    );
    await Promise.resolve();

    expect(harness.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("rejects a child that exits before its matching health response completes", async () => {
    const healthPid = 575757;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      exitBeforeHealth: true,
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "Server exited during startup",
    );

    await vi.runAllTimersAsync();
    await start;

    expect(harness.child.kill).toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("rolls back a healthy child when the OS startup lock cannot be released", async () => {
    const lockReleaseError = new Error("injected socket-close failure");
    const healthPid = 535353;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      lockReleaseError,
    });
    const { startServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).rejects.toBe(lockReleaseError);

    await vi.runAllTimersAsync();
    await start;

    expect(harness.killedPids).toContain(healthPid);
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("tracks sudo launcher and healthy child PIDs separately through stop", async () => {
    const launcherPid = 515151;
    const healthPid = 525252;
    const harness = installLifecycleHarness({ tmpDir, restorers, launcherPid, healthPid });
    const { startServer, stopServer } = require("../../src/mitm/manager.js");

    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toEqual({
      running: true,
      pid: healthPid,
    });
    await vi.runAllTimersAsync();
    await start;
    const record = JSON.parse(fs.readFileSync(path.join(harness.mitmDir, ".mitm.pid"), "utf8"));
    expect(record).toMatchObject({
      pid: healthPid,
      launcherPid,
      nonce: harness.instanceNonce,
      state: "running",
    });

    const stop = stopServer("fixture-password");
    await vi.advanceTimersByTimeAsync(1000);
    await expect(stop).resolves.toEqual({ running: false, pid: null });

    expect(harness.killedPids).toContain(healthPid);
    expect(harness.killedPids).toContain(launcherPid);
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("keeps a verified server running when DNS cleanup fails before stop", async () => {
    const dnsError = new Error("injected hosts cleanup failure");
    const healthPid = 525253;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid,
      dnsRemovalError: dnsError,
    });
    const { startServer, stopServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toMatchObject({ pid: healthPid });
    await vi.runAllTimersAsync();
    await start;
    const removalCount = harness.commands.filter((command) => command.includes("-F all")).length;

    await expect(stopServer("fixture-password")).rejects.toBe(dnsError);
    expect(harness.child.kill).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(true);
    expect(harness.commands.filter((command) => command.includes("-F all"))).toHaveLength(removalCount);
  });

  it("treats an unexpected clean child exit as restartable without discarding ownership", async () => {
    const healthPid = 525254;
    const harness = installLifecycleHarness({ tmpDir, restorers, healthPid });
    const updateSettings = vi.fn(async () => {});
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(async () => ({ mitmEnabled: true }), updateSettings);
    const start = expect(manager.startServer("fixture-key", "fixture-password")).resolves.toMatchObject({ pid: healthPid });
    await vi.runAllTimersAsync();
    await start;

    harness.child.emit("exit", 0);
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(harness.removeAllDNSEntries).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(true);
    expect(updateSettings).not.toHaveBeenCalledWith(expect.objectContaining({ mitmEnabled: false }));
  });

  it("clears legacy stored sudo ciphertext and never returns it", async () => {
    installLifecycleHarness({ tmpDir, restorers });
    const updateSettings = vi.fn(async () => {});
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(
      async () => ({ mitmSudoEncrypted: "legacy-ciphertext" }),
      updateSettings,
    );

    await expect(manager.loadEncryptedPassword()).resolves.toBeNull();
    expect(updateSettings).toHaveBeenCalledWith({ mitmSudoEncrypted: null });
    expect(updateSettings.mock.calls.flatMap(([value]) => Object.values(value))).not.toContain(
      "legacy-ciphertext",
    );
  });

  it("fails closed when legacy sudo ciphertext cannot be purged", async () => {
    installLifecycleHarness({ tmpDir, restorers });
    const purgeError = new Error("settings write failed");
    const manager = require("../../src/mitm/manager.js");
    manager.initDbHooks(
      async () => ({ mitmSudoEncrypted: "legacy-ciphertext" }),
      vi.fn(async () => { throw purgeError; }),
    );

    await expect(manager.loadEncryptedPassword()).rejects.toBe(purgeError);
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it("runs the full proxy unprivileged with a sanitized child environment", async () => {
    const previousNodeOptions = process.env.NODE_OPTIONS;
    const previousNodePath = process.env.NODE_PATH;
    process.env.NODE_OPTIONS = "--require=/tmp/hostile.js";
    process.env.NODE_PATH = "/tmp/hostile-modules";
    try {
      const healthPid = 666666;
      const harness = installLifecycleHarness({ tmpDir, restorers, healthPid });
      const { startServer } = require("../../src/mitm/manager.js");
      const start = expect(startServer("super-secret-router-key", "fixture-password")).resolves.toMatchObject({ pid: healthPid });
      await vi.runAllTimersAsync();
      await start;

      const [command, args, options] = childProcess.spawn.mock.calls[0];
      expect(command).toBe(process.execPath);
      expect(args).toContain("--durindoor-mitm-entry");
      expect(args.join(" ")).not.toContain("super-secret-router-key");
      expect(args.join(" ")).not.toContain(harness.instanceNonce);
      expect(options.env).toMatchObject({
        ROUTER_API_KEY: "super-secret-router-key",
        MITM_INSTANCE_NONCE: harness.instanceNonce,
        MITM_CA_PREPARED: "1",
        MITM_LISTEN_PORT: "8443",
      });
      expect(options.env).not.toHaveProperty("NODE_OPTIONS");
      expect(options.env).not.toHaveProperty("NODE_PATH");
      expect(harness.commands.some((entry) => entry.includes("8443"))).toBe(true);
    } finally {
      if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previousNodeOptions;
      if (previousNodePath === undefined) delete process.env.NODE_PATH;
      else process.env.NODE_PATH = previousNodePath;
    }
  });

  it("refuses to spawn the full proxy from an elevated parent", async () => {
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      healthPid: 676767,
      parentIsAdmin: true,
      existingRootCA: true,
      rootCAValid: false,
    });
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toThrow(
      "Refusing to run the full MITM proxy with an elevated parent",
    );
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(harness.ensureRootCASync).not.toHaveBeenCalled();
    expect(harness.installCert).not.toHaveBeenCalled();
    expect(harness.uninstallCert).not.toHaveBeenCalled();
    expect(harness.commands).toEqual([]);
    expect(harness.child.kill).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("stops a nonce-authenticated child from a fresh-manager starting record", async () => {
    const launcherPid = 616161;
    const healthPid = 626262;
    const nonce = "e".repeat(48);
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid,
      healthPid,
      initialNonce: nonce,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.writeFileSync(pidPath, `${JSON.stringify({
      version: 1,
      pid: launcherPid,
      launcherPid,
      nonce,
      state: "starting",
      launcherStart: harness.launcherStart,
    })}\n`);

    const { stopServer } = require("../../src/mitm/manager.js");
    const stop = stopServer("fixture-password");
    await vi.runAllTimersAsync();
    await expect(stop).resolves.toEqual({ running: false, pid: null });

    expect(harness.killedPids).toContain(healthPid);
    expect(harness.killedPids).toContain(launcherPid);
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it("does not mutate global redirect state when stop has no ownership record", async () => {
    const harness = installLifecycleHarness({ tmpDir, restorers });
    const { stopServer } = require("../../src/mitm/manager.js");

    await expect(stopServer("fixture-password")).resolves.toEqual({ running: false, pid: null });
    expect(harness.commands).toEqual([]);
    expect(harness.child.kill).not.toHaveBeenCalled();
  });

  it("kills a locally tracked launcher tree when health is unavailable", async () => {
    const launcherPid = 636363;
    const healthPid = 646464;
    const harness = installLifecycleHarness({ tmpDir, restorers, launcherPid, healthPid });
    const { startServer, stopServer } = require("../../src/mitm/manager.js");
    const start = expect(startServer("fixture-key", "fixture-password")).resolves.toMatchObject({ pid: healthPid });
    await vi.runAllTimersAsync();
    await start;

    https.request = vi.fn((options, callback) => {
      const request = new EventEmitter();
      request.setTimeout = vi.fn();
      request.destroy = (error) => request.emit("error", error);
      request.end = () => queueMicrotask(() => {
        const response = new EventEmitter();
        callback(response);
        response.emit("data", JSON.stringify({ ok: false }));
        response.emit("end");
      });
      return request;
    });

    await expect(stopServer("fixture-password")).resolves.toEqual({ running: false, pid: null });
    expect(harness.killedPids).toContain(launcherPid);
    expect(harness.removeLegacyDNSEntries).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(harness.mitmDir, ".mitm.pid"))).toBe(false);
  });

  it("rejects and preserves a live legacy integer PID record", async () => {
    const legacyPid = 656565;
    const harness = installLifecycleHarness({
      tmpDir,
      restorers,
      launcherPid: legacyPid,
      healthPid: legacyPid,
      launcherProbeDenied: true,
    });
    fs.mkdirSync(harness.mitmDir, { recursive: true });
    const pidPath = path.join(harness.mitmDir, ".mitm.pid");
    fs.writeFileSync(pidPath, `${legacyPid}\n`);
    const { startServer } = require("../../src/mitm/manager.js");

    await expect(startServer("fixture-key", "fixture-password")).rejects.toMatchObject({
      code: "MITM_OWNERSHIP_UNVERIFIED",
    });
    expect(childProcess.spawn).not.toHaveBeenCalled();
    expect(harness.killedPids).toEqual([]);
    expect(harness.commands).toEqual([]);
    expect(fs.existsSync(pidPath)).toBe(true);
  });
});
