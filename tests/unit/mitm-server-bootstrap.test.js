import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import https from "node:https";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const modulePaths = [
  "../../src/mitm/server.js",
  "../../src/mitm/serverBootstrap.js",
  "../../src/mitm/cert/generate.js",
  "../../src/mitm/cert/rootCA.js",
  "../../src/mitm/logger.js",
  "../../src/mitm/dbReader.js",
  "../../src/mitm/paths.js",
].map((modulePath) => require.resolve(modulePath));

function clearMitmModules() {
  for (const modulePath of modulePaths) delete require.cache[modulePath];
}

function loadServer(dataDir) {
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  clearMitmModules();
  try {
    return require("../../src/mitm/server.js");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}

function loadBootstrap(dataDir) {
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  clearMitmModules();
  try {
    return require("../../src/mitm/serverBootstrap.js");
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
  }
}

function createFakeServer() {
  return {
    close: vi.fn((callback) => callback?.()),
    listen: vi.fn((...args) => {
      const callback = args.at(-1);
      if (typeof callback === "function") callback();
    }),
    on: vi.fn(),
  };
}

function createResponseRecorder() {
  return {
    status: null,
    headers: null,
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; },
  };
}

const trustedPeer = { verifyPeerOwner: async () => true };

describe("MITM executable bootstrap", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-mitm-bootstrap-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearMitmModules();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("keeps server imports free of certificate, listener, and signal side effects", () => {
    const createServer = vi.spyOn(https, "createServer");
    const sigintBefore = process.listenerCount("SIGINT");
    const sigtermBefore = process.listenerCount("SIGTERM");

    const serverModule = loadServer(path.join(tmpDir, "data"));

    expect(serverModule.startMitmServer).toBeTypeOf("function");
    expect(createServer).not.toHaveBeenCalled();
    expect(process.listenerCount("SIGINT")).toBe(sigintBefore);
    expect(process.listenerCount("SIGTERM")).toBe(sigtermBefore);
    expect(fs.existsSync(path.join(tmpDir, "data", "mitm", "rootCA.key"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "data", "mitm", "rootCA.crt"))).toBe(false);
  });

  it("uses the canonical Root CA helper once before reading TLS material", async () => {
    const { loadRootCATls } = loadBootstrap(path.join(tmpDir, "data"));
    const order = [];
    const ensureRootCA = vi.fn(() => { order.push("ensure"); return true; });
    const readFile = vi.fn((filePath) => {
      order.push(path.basename(filePath));
      return Buffer.from(filePath.endsWith(".key") ? "key" : "cert");
    });

    await expect(loadRootCATls({
      ensureRootCA,
      readFile,
      keyPath: "/fixture/rootCA.key",
      certPath: "/fixture/rootCA.crt",
      withLock: async (operation) => operation(),
    })).resolves.toEqual({
      generated: true,
      key: Buffer.from("key"),
      cert: Buffer.from("cert"),
      rootCAPem: "cert",
    });
    expect(order).toEqual(["ensure", "rootCA.key", "rootCA.crt"]);
  });

  it("reads a manager-prepared CA without mutating it again", async () => {
    const { loadRootCATls } = loadBootstrap(path.join(tmpDir, "data"));
    const ensureRootCA = vi.fn();
    const readFile = vi.fn((filePath) => Buffer.from(filePath.endsWith(".key") ? "key" : "cert"));

    await expect(loadRootCATls({
      ensureRootCA,
      readFile,
      keyPath: "/fixture/rootCA.key",
      certPath: "/fixture/rootCA.crt",
      withLock: async (operation) => operation(),
      caPrepared: true,
    })).resolves.toMatchObject({ generated: false, rootCAPem: "cert" });
    expect(ensureRootCA).not.toHaveBeenCalled();
  });

  it("rejects a symlinked prepared TLS path without changing its target", () => {
    const { readRegularFileNoFollow } = loadBootstrap(path.join(tmpDir, "data"));
    const outside = path.join(tmpDir, "outside-sentinel");
    const link = path.join(tmpDir, "rootCA.key");
    fs.writeFileSync(outside, "sentinel", { mode: 0o600 });
    fs.symlinkSync(outside, link);
    const beforeMode = fs.statSync(outside).mode & 0o777;

    expect(() => readRegularFileNoFollow(link)).toThrow("Unsafe MITM TLS path");
    expect(fs.readFileSync(outside, "utf8")).toBe("sentinel");
    expect(fs.statSync(outside).mode & 0o777).toBe(beforeMode);
  });

  it("preserves the primary CA operation error when lock release also fails", async () => {
    const { withRootCALock } = loadBootstrap(path.join(tmpDir, "data"));
    const operationError = new Error("operation failed");
    const cleanupError = new Error("release failed");

    await expect(withRootCALock(
      async () => { throw operationError; },
      { acquire: async () => ({ owner: true }), release: async () => { throw cleanupError; } },
    )).rejects.toBe(operationError);
    expect(operationError.cleanupError).toBe(cleanupError);
  });

  it("does not read, create, listen, or exit when Root CA generation fails", async () => {
    const serverModule = loadServer(path.join(tmpDir, "data"));
    const fakeServer = createFakeServer();
    const httpsModule = { createServer: vi.fn(() => fakeServer) };
    const processImpl = { exit: vi.fn(), on: vi.fn(), platform: process.platform };
    const failure = new Error("fixture CA failure");

    await expect(serverModule.startMitmServer({
      httpsModule,
      loadTls: () => { throw failure; },
      clearDumpDirFn: vi.fn(),
      processImpl,
      waitForAuthorization: async () => true,
    })).rejects.toThrow(failure);
    expect(httpsModule.createServer).not.toHaveBeenCalled();
    expect(fakeServer.listen).not.toHaveBeenCalled();
    expect(processImpl.exit).not.toHaveBeenCalled();
  });

  it("generates a real first-run CA before one injected HTTPS listen", async () => {
    const dataDir = path.join(tmpDir, "data");
    const serverModule = loadServer(dataDir);
    const { loadRootCATls } = loadBootstrap(dataDir);
    const fakeServer = createFakeServer();
    const httpsModule = { createServer: vi.fn(() => fakeServer) };
    const processImpl = { exit: vi.fn(), on: vi.fn(), platform: process.platform };

    const result = await serverModule.startMitmServer({
      httpsModule,
      loadTls: () => loadRootCATls({ withLock: async (operation) => operation() }),
      clearDumpDirFn: vi.fn(),
      processImpl,
      removeDnsEntries: vi.fn(),
      waitForAuthorization: async () => true,
    });

    expect(fs.readFileSync(path.join(dataDir, "mitm", "rootCA.key"), "utf8")).toContain("BEGIN RSA PRIVATE KEY");
    expect(fs.readFileSync(path.join(dataDir, "mitm", "rootCA.crt"), "utf8")).toContain("BEGIN CERTIFICATE");
    expect(httpsModule.createServer).toHaveBeenCalledTimes(1);
    expect(fakeServer.listen).toHaveBeenCalledWith(8443, "127.0.0.1", expect.any(Function));
    expect(processImpl.on).toHaveBeenCalledTimes(process.platform === "win32" ? 3 : 2);
    expect(result.server).toBe(fakeServer);
  });

  it("registers an idempotent shutdown callback", () => {
    const serverModule = loadServer(path.join(tmpDir, "data"));
    const fakeServer = createFakeServer();
    const removeDnsEntries = vi.fn();
    const processImpl = { exit: vi.fn(), on: vi.fn(), platform: "linux" };
    const shutdown = serverModule.registerShutdownHandlers(fakeServer, {
      processImpl,
      removeDnsEntries,
    });

    shutdown();
    shutdown();

    expect(removeDnsEntries).not.toHaveBeenCalled();
    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(processImpl.exit).toHaveBeenCalledTimes(1);
  });

  it("requires a health challenge and returns only an HMAC proof", async () => {
    const serverModule = loadServer(path.join(tmpDir, "data"));
    const nonce = "a".repeat(48);
    const challenge = "b".repeat(64);
    const previousNonce = process.env.MITM_INSTANCE_NONCE;
    process.env.MITM_INSTANCE_NONCE = nonce;
    try {
      for (const supplied of [undefined, "wrong", "é".repeat(48)]) {
        const response = createResponseRecorder();
        await serverModule.handleRequest({
          url: "/_mitm_health",
          headers: supplied ? { "x-durindoor-mitm-challenge": supplied } : {},
        }, response, trustedPeer);
        expect(response.status).toBe(404);
      }

      const response = createResponseRecorder();
      await serverModule.handleRequest({
        url: "/_mitm_health",
        headers: { "x-durindoor-mitm-challenge": challenge },
      }, response, trustedPeer);
      expect(response.status).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toEqual({
        ok: true,
        pid: process.pid,
        proof: crypto.createHmac("sha256", nonce).update(challenge).digest("hex"),
      });
      expect(response.body).not.toContain(nonce);
    } finally {
      if (previousNonce === undefined) delete process.env.MITM_INSTANCE_NONCE;
      else process.env.MITM_INSTANCE_NONCE = previousNonce;
    }
  });

  it("rejects unsupported Host and SNI names and keeps one CA snapshot for allowed SNI", async () => {
    const dataDir = path.join(tmpDir, "data");
    const serverModule = loadServer(dataDir);
    const { loadRootCATls } = loadBootstrap(dataDir);
    const tlsOptions = await loadRootCATls({ withLock: async (operation) => operation() });
    const fakeServer = createFakeServer();
    serverModule.createMitmServer({
      httpsModule: { createServer: vi.fn(() => fakeServer) },
      tlsOptions,
    });

    const hostResponse = createResponseRecorder();
    await serverModule.handleRequest(
      { url: "/v1/models", headers: { host: "attacker.example" } },
      hostResponse,
      trustedPeer,
    );
    expect(hostResponse.status).toBe(421);

    const peerResponse = createResponseRecorder();
    await serverModule.handleRequest(
      { url: "/v1/models", headers: { host: "api2.cursor.sh" }, socket: {} },
      peerResponse,
      { verifyPeerOwner: async () => false },
    );
    expect(peerResponse.status).toBe(403);

    await expect(new Promise((resolve, reject) => {
      serverModule.sniCallback("attacker.example", (error, context) => {
        if (error) reject(error);
        else resolve(context);
      });
    })).rejects.toThrow("Unsupported MITM SNI hostname");

    fs.unlinkSync(path.join(dataDir, "mitm", "rootCA.key"));
    fs.unlinkSync(path.join(dataDir, "mitm", "rootCA.crt"));
    await expect(new Promise((resolve, reject) => {
      serverModule.sniCallback("api2.cursor.sh", (error, context) => {
        if (error) reject(error);
        else resolve(context);
      });
    })).resolves.toBeTruthy();
  });
});
