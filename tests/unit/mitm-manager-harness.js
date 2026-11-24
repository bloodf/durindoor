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

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function cacheModule(modulePath, exports, restorers) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  restorers.push(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

export function installLifecycleHarness({
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
  const startLockApi = require("../../src/mitm/startLock.js");
  cacheModule("../../src/mitm/startLock.js", {
    ...startLockApi,
    acquireSocketLock: vi.fn(async () => {
      if (lockContention) throw Object.assign(new Error("lock contention"), { code: "MITM_START_IN_PROGRESS" });
      return { fixtureLock: true };
    }),
    releaseSocketLock: vi.fn(async () => {
      if (lockReleaseError) throw lockReleaseError;
      return true;
    }),
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
        if (serverId === 1 && internalPortBusy) {
          callbacks.error?.(Object.assign(new Error("address in use"), { code: "EADDRINUSE" }));
          return;
        }
        const callback = args.at(-1);
        if (typeof callback === "function") callback();
        else callbacks.listening?.();
      },
      close(callback) {
        callback?.(null);
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
    setHealthNonce(value) { healthServerNonce = value; },
    setPublicHealthFailure(value) { publicHealthFailure = value; },
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

