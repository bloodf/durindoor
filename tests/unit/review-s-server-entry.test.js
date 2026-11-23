import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const gateway = require("../../custom-server.js");

describe("shared gateway server entry", () => {
  it("resolves ports, hosts, and rejects out-of-range ports", () => {
    expect(gateway.resolveListenConfig({ argv: [], env: {}, dev: true })).toEqual({ port: 20127, host: "127.0.0.1" });
    expect(gateway.resolveListenConfig({ argv: [], env: {}, dev: false })).toEqual({ port: 20128, host: "127.0.0.1" });
    expect(gateway.resolveListenConfig({ argv: ["node", "entry", "--port", "8080"], env: { HOSTNAME: "0.0.0.0" }, dev: true })).toEqual({ port: 8080, host: "0.0.0.0" });
    expect(() => gateway.resolveListenConfig({ argv: [], env: { PORT: "65536" }, dev: false })).toThrow("Invalid server port");
  });

  it("uses the shared wrapped server factory for dev and standalone server creation", async () => {
    const server = new EventEmitter();
    server.listen = vi.fn((_port, _host, ready) => ready());
    const http = { createServer: vi.fn(() => server) };
    const nextUpgrade = vi.fn();
    const app = { prepare: () => Promise.resolve(), getRequestHandler: () => vi.fn(), getUpgradeHandler: () => nextUpgrade };
    const script = fs.readFileSync(path.join(root, "scripts/next-owner-server.cjs"), "utf8");
    const context = {
      __dirname: path.join(root, "scripts"),
      require(id) {
        if (id === "http") return http;
        if (id === "next") return () => app;
        if (id === "path") return path;
        if (id === "../custom-server") return gateway;
        throw new Error(`Unexpected require: ${id}`);
      },
      process: { ...process, argv: [process.execPath, "wrapper", "--dev"], env: { ...process.env }, exit: vi.fn() },
      console,
      Buffer,
    };
    vm.runInNewContext(script, context, { filename: "next-owner-server.cjs" });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(http.createServer).toHaveBeenCalledOnce();
    expect(server.listeners("upgrade")).toHaveLength(1);
    expect(server.keepAliveTimeout).toBe(72_000);
    expect(server.headersTimeout).toBe(76_000);

    const standaloneServer = new EventEmitter();
    const standaloneHttp = { createServer: vi.fn(() => standaloneServer) };
    const wrapped = gateway.createGatewayServer(vi.fn(), { httpModule: standaloneHttp, dashboardPort: 20128 });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(wrapped).toBe(standaloneServer);
    expect(standaloneHttp.createServer).toHaveBeenCalledOnce();
    expect(standaloneServer.listeners("upgrade")).toHaveLength(1);
    expect(standaloneServer.keepAliveTimeout).toBe(72_000);
  });
});
