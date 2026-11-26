import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import https from "https";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const cloudflaredSource = fs.readFileSync(
  path.join(import.meta.dirname, "../../src/lib/tunnel/cloudflare/cloudflared.js"),
  "utf8"
);
const updaterSource = fs.readFileSync(
  path.join(import.meta.dirname, "../../src/lib/updater/updater.js"),
  "utf8"
);
const updateRouteSource = fs.readFileSync(
  path.join(import.meta.dirname, "../../src/app/api/version/update/route.js"),
  "utf8"
);

const updateRouteMocks = vi.hoisted(() => ({
  killAppProcesses: vi.fn(async () => {}),
  spawnUpdaterAndExit: vi.fn(),
}));

describe("#2213 cloudflared download pin + digest", () => {
  it("pins a release download URL instead of releases/latest", () => {
    expect(cloudflaredSource).not.toMatch(/releases\/latest\/download/);
    expect(cloudflaredSource).toMatch(/releases\/download\/\$\{CLOUDFLARED_VERSION\}/);
  });

  it("hard-codes per-platform SHA-256 digests for the pinned release", async () => {
    const {
      CLOUDFLARED_VERSION,
      CLOUDFLARED_ASSET_SHA256,
    } = await import("../../src/lib/tunnel/cloudflare/cloudflared.js");

    expect(CLOUDFLARED_VERSION).toMatch(/^\d{4}\.\d+\.\d+$/);
    for (const asset of [
      "cloudflared-linux-amd64",
      "cloudflared-linux-arm64",
      "cloudflared-darwin-amd64.tgz",
      "cloudflared-darwin-arm64.tgz",
      "cloudflared-windows-amd64.exe",
      "cloudflared-windows-386.exe",
    ]) {
      expect(CLOUDFLARED_ASSET_SHA256[asset]).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("deletes the file and throws when the SHA-256 does not match", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dd-cloudflared-digest-"));
    const badFile = path.join(dir, "cloudflared-linux-amd64");
    fs.writeFileSync(badFile, "not-the-real-binary");

    const { verifyCloudflaredAssetDigest } = await import(
      "../../src/lib/tunnel/cloudflare/cloudflared.js"
    );

    expect(() => verifyCloudflaredAssetDigest(badFile, "cloudflared-linux-amd64")).toThrow(
      /SHA-256 mismatch/
    );
    expect(fs.existsSync(badFile)).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps pinned digests distinct from arbitrary fixture content", async () => {
    const {
      CLOUDFLARED_ASSET_SHA256,
      verifyCloudflaredAssetDigest,
    } = await import("../../src/lib/tunnel/cloudflare/cloudflared.js");

    const asset = "cloudflared-linux-amd64";
    const payload = Buffer.from("cloudflared-fixture-body");
    const actual = createHash("sha256").update(payload).digest("hex");
    expect(actual).not.toBe(CLOUDFLARED_ASSET_SHA256[asset]);
    expect(CLOUDFLARED_ASSET_SHA256[asset]).toHaveLength(64);
    expect(verifyCloudflaredAssetDigest).toEqual(expect.any(Function));
  });

  it("spawns cloudflared with a minimal env, not the full process.env", async () => {
    const { buildCloudflaredEnv } = await import(
      "../../src/lib/tunnel/cloudflare/cloudflared.js"
    );

    process.env.SECRET_SHOULD_NOT_LEAK = "leak-me";
    process.env.PATH = process.env.PATH || "/usr/bin";
    const env = buildCloudflaredEnv({ TUNNEL_TRANSPORT_PROTOCOL: "http2" });

    expect(env.PATH).toBe(process.env.PATH);
    expect(env.TUNNEL_TRANSPORT_PROTOCOL).toBe("http2");
    expect(env.SECRET_SHOULD_NOT_LEAK).toBeUndefined();
    expect(Object.keys(env).every((k) =>
      [
        "PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SystemRoot",
        "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "no_proxy", "all_proxy",
        "TUNNEL_TRANSPORT_PROTOCOL",
      ].includes(k)
    )).toBe(true);

    delete process.env.SECRET_SHOULD_NOT_LEAK;
  });

  it("passes buildCloudflaredEnv into spawn for quick tunnels", async () => {
    vi.resetModules();

    const spawnArgs = [];
    const child = {
      pid: 4242,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      on: vi.fn(),
      kill: vi.fn(),
    };
    const spawn = vi.fn((_bin, args, opts) => {
      spawnArgs.push({ args, opts });
      setTimeout(() => {
        child.stdout.emit("data", Buffer.from("INF | https://abc123.trycloudflare.com\n"));
      }, 0);
      return child;
    });

    const fsStub = {
      existsSync: vi.fn(() => true),
      statSync: vi.fn(() => ({ size: 50 * 1024 * 1024 })),
      openSync: vi.fn(() => 7),
      readSync: vi.fn((_fd, buf) => {
        Buffer.from(process.platform === "win32" ? "4d5a0000" : process.platform === "darwin" ? "cffaedfe" : "7f454c46", "hex").copy(buf);
        return 4;
      }),
      closeSync: vi.fn(),
      chmodSync: vi.fn(),
      mkdirSync: vi.fn(),
      unlinkSync: vi.fn(),
      mkdtempSync: vi.fn(() => "/tmp/dd-cloudflared-env-test"),
      writeFileSync: vi.fn(),
      rmSync: vi.fn(),
      createWriteStream: vi.fn(() => { throw new Error("cloudflared download attempted in test"); }),
    };

    vi.doMock("fs", () => ({ default: fsStub, ...fsStub }));
    vi.doMock("child_process", () => ({ execSync: vi.fn(() => ""), spawn }));
    vi.doMock("https", () => ({ default: { get: vi.fn(() => { throw new Error("network access attempted in test"); }) } }));
    vi.doMock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/dd-cloudflared-env-data" }));
    vi.doMock("@/lib/tunnel/cloudflare/pid.js", () => ({
      savePid: vi.fn(),
      loadPid: vi.fn(() => null),
      clearPid: vi.fn(),
    }));

    process.env.SECRET_SHOULD_NOT_LEAK = "leak-me";
    const { spawnQuickTunnel } = await import("../../src/lib/tunnel/cloudflare/cloudflared.js");
    await spawnQuickTunnel(20128, vi.fn());

    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0].opts.env.SECRET_SHOULD_NOT_LEAK).toBeUndefined();
    expect(spawnArgs[0].opts.env.TUNNEL_TRANSPORT_PROTOCOL).toBeTruthy();

    delete process.env.SECRET_SHOULD_NOT_LEAK;
    vi.doUnmock("fs");
    vi.doUnmock("child_process");
    vi.doUnmock("https");
    vi.doUnmock("@/lib/dataDir.js");
    vi.doUnmock("@/lib/tunnel/cloudflare/pid.js");
    vi.resetModules();
  });
});

describe("#2213 updater pin + hash + CORS", () => {
  it("update route installs durindoor@<version>, never @latest", () => {
    expect(updateRouteSource).not.toMatch(/npmPackageName\}@latest/);
    expect(updateRouteSource).not.toMatch(/["'`][^"'`]*@latest["'`]/);
    expect(updateRouteSource).toMatch(/npmPackageName\}@\$\{latestVersion\}/);
    expect(updateRouteSource).toMatch(/fetchLatestVersion/);
  });

  it("updater status server allows only the exact loopback dashboard origins", () => {
    expect(updaterSource).toMatch(/setStatusCorsHeaders/);
    const { setStatusCorsHeaders } = require("../../src/lib/updater/statusCors.cjs");
    for (const origin of ["http://localhost:20128", "http://127.0.0.1:20128"]) {
      const headers = {};
      setStatusCorsHeaders({ headers: { origin } }, { setHeader: (key, value) => { headers[key] = value; } }, 20128);
      expect(headers).toEqual({ Vary: "Origin", "Access-Control-Allow-Origin": origin });
    }
    for (const origin of ["https://localhost:20128", "http://localhost:20129", "http://evil.example"]) {
      const headers = {};
      setStatusCorsHeaders({ headers: { origin } }, { setHeader: (key, value) => { headers[key] = value; } }, 20128);
      expect(headers).toEqual({ Vary: "Origin" });
    }
    expect(updaterSource).not.toMatch(/Access-Control-Allow-Origin.{0,10}\*/);
  });

  it("updater refuses an unpinned @latest install spec", () => {
    expect(updaterSource).toMatch(/isPinnedInstallSpec/);
    expect(updaterSource).toMatch(/@latest/);
    expect(updaterSource).toMatch(/Refusing unpinned install spec/);
  });

  it("ensureRuntimeUpdater compares content hashes, not file sizes", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dd-updater-hash-")));
    const bundled = path.join(dir, "bundled.js");
    const runtimeDir = path.join(dir, "runtime", "updater");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const runtime = path.join(runtimeDir, "updater.js");

    // Same size, different content — size-only check would reuse the stale copy.
    fs.writeFileSync(bundled, "AAAA");
    fs.writeFileSync(runtime, "BBBB");
    expect(fs.statSync(bundled).size).toBe(fs.statSync(runtime).size);

    const prev = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;

    vi.resetModules();
    vi.doMock("@/mitm/manager", () => ({
      stopServer: vi.fn(),
      getCachedPassword: vi.fn(),
      loadEncryptedPassword: vi.fn(),
    }));
    vi.doMock("../../cli/src/lib/processScan.js", () => ({
      default: { collectAppPids: () => [], killAppPids: () => {} },
    }));

    const { ensureRuntimeUpdater } = await import("../../src/lib/appUpdater.js");
    const result = ensureRuntimeUpdater(bundled);

    expect(result).toBe(runtime);
    expect(fs.readFileSync(runtime, "utf8")).toBe("AAAA");

    // Identical content is reused without rewrite.
    const before = fs.statSync(runtime).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const again = ensureRuntimeUpdater(bundled);
    expect(again).toBe(runtime);
    expect(fs.statSync(runtime).mtimeMs).toBe(before);

    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
    vi.doUnmock("@/mitm/manager");
    vi.doUnmock("../../cli/src/lib/processScan.js");
    vi.resetModules();
  });

  it("POST /api/version/update spawns a version-pinned package name", async () => {
    updateRouteMocks.killAppProcesses.mockClear();
    updateRouteMocks.spawnUpdaterAndExit.mockClear();

    vi.resetModules();
    vi.doMock("next/server", () => ({
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status || 200 }),
      },
    }));
    vi.doMock("@/lib/appUpdater", () => ({
      killAppProcesses: updateRouteMocks.killAppProcesses,
      spawnUpdaterAndExit: updateRouteMocks.spawnUpdaterAndExit,
    }));

    const getSpy = vi.spyOn(https, "get").mockImplementation((_url, _opts, cb) => {
      const res = new EventEmitter();
      res.statusCode = 200;
      queueMicrotask(() => {
        cb(res);
        res.emit("data", JSON.stringify({ version: "9.9.9" }));
        res.emit("end");
      });
      return Object.assign(new EventEmitter(), {
        on: EventEmitter.prototype.on,
        destroy: vi.fn(),
      });
    });

    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const route = await import("../../src/app/api/version/update/route.js");
    const response = await route.POST();

    expect(response.status).toBe(200);
    expect(updateRouteMocks.spawnUpdaterAndExit).toHaveBeenCalledWith("durindoor@9.9.9");
    expect(updateRouteMocks.spawnUpdaterAndExit.mock.calls[0][0]).not.toMatch(/@latest/);

    process.env.NODE_ENV = prev;
    getSpy.mockRestore();
    vi.doUnmock("next/server");
    vi.doUnmock("@/lib/appUpdater");
    vi.resetModules();
  });
});
