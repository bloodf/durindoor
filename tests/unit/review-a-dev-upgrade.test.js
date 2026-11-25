import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const customServer = require("../../custom-server.js");

afterEach(() => vi.unstubAllEnvs());

describe("development server upgrade routing", () => {
  it("denies isolated login-host upgrades and routes realtime upgrades through the dispatcher", async () => {
    vi.stubEnv("BASE_URL", "https://gateway.example");
    vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.gateway.example");
    const server = new EventEmitter();
    server.listen = vi.fn((_port, _host, ready) => ready());
    const nextUpgrade = vi.fn();
    const app = {
      prepare: () => Promise.resolve(),
      getRequestHandler: () => vi.fn(),
      getUpgradeHandler: () => nextUpgrade,
    };
    const http = { createServer: vi.fn(() => server) };
    const script = fs.readFileSync(path.join(repoRoot, "scripts/next-owner-server.cjs"), "utf8");
    const context = {
      __dirname: path.join(repoRoot, "scripts"),
      require(id) {
        if (id === "http") return http;
        if (id === "next") return () => app;
        if (id === "path") return path;
        if (id === "../custom-server") return customServer;
        throw new Error(`Unexpected require: ${id}`);
      },
      process: { ...process, argv: [process.execPath, "wrapper", "--dev"], env: { ...process.env }, exit: vi.fn() },
      console,
      Buffer,
    };
    vm.runInNewContext(script, context, { filename: "next-owner-server.cjs" });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const isolatedSocket = { end: vi.fn(), destroy: vi.fn() };
    server.emit("upgrade", {
      url: "/v1/realtime", method: "GET", headers: { host: "login.gateway.example" },
    }, isolatedSocket, Buffer.alloc(0));
    expect(nextUpgrade).not.toHaveBeenCalled();
    expect(isolatedSocket.end).toHaveBeenCalledWith(expect.stringContaining("403 Forbidden"));

    const realtimeSocket = { end: vi.fn(), destroy: vi.fn() };
    server.emit("upgrade", {
      url: "/v1/realtime", method: "GET", headers: { host: "gateway.example" },
    }, realtimeSocket, Buffer.alloc(0));
    expect(nextUpgrade).not.toHaveBeenCalled();
    expect(realtimeSocket.destroy).toHaveBeenCalled();
  });
});
