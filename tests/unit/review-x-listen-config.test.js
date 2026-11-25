import { createRequire } from "node:module";
import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { resolveServerHost } from "@/lib/startup/nonLoopbackApiKeyGuard.js";

const require = createRequire(import.meta.url);
const shared = require("../../src/lib/startup/listenConfig.cjs");
const gateway = require("../../custom-server.js");
const ownerSource = fs.readFileSync(new URL("../../scripts/next-owner-server.cjs", import.meta.url), "utf8");
const cliSource = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

function launcher(env, args = []) {
  const start = cliSource.indexOf("// Parse arguments");
  const end = cliSource.indexOf("// Auto-relaunch after update:", start);
  const context = { args, process: { env, exit: () => { throw new Error("launcher rejected port"); } }, console,
    DEFAULT_HOST: shared.DEFAULT_SERVER_HOST, resolveListenConfig: (options) => shared.resolveListenConfig({ ...options, env }) };
  return vm.runInNewContext(`${cliSource.slice(start, end)}\n({ port, host })`, context);
}

function owner(env) {
  let address;
  const context = {
    __dirname: "/private/scripts",
    process: { argv: [], env },
    require(id) {
      if (id === "path") return require("node:path");
      if (id === "http") return {};
      if (id === "../custom-server") return { ...gateway, canonicalizeRuntimePaths() {}, setProcessTitle() {} };
      if (id === "next") return (options) => { address = { host: options.hostname, port: options.port }; return { prepare: () => new Promise(() => {}) }; };
      throw new Error(id);
    },
    console,
  };
  vm.runInNewContext(ownerSource, context);
  return address;
}

describe("shared listen configuration", () => {
  it("uses the same environment for the launcher, gateway and guard", () => {
    const env = { PORT: "23456", HOSTNAME: "192.0.2.1" };
    const expected = { port: 23456, host: "192.0.2.1" };
    expect(shared.resolveListenConfig({ env, argv: [] })).toEqual(expected);
    expect(gateway.resolveListenConfig({ env, argv: [] })).toEqual(expected);
    expect(launcher(env)).toEqual(expected);
    expect(owner({ ...env })).toEqual(expected);
    const old = { PORT: process.env.PORT, HOSTNAME: process.env.HOSTNAME };
    try {
      Object.assign(process.env, env);
      expect(resolveServerHost()).toBe(expected.host);
    } finally {
      for (const key of Object.keys(old)) {
        if (old[key] === undefined) delete process.env[key];
        else process.env[key] = old[key];
      }
    }
  });

  it("rejects an out-of-range environment port in each resolver", () => {
    const env = { PORT: "65536" };
    expect(() => shared.resolveListenConfig({ env, argv: [] })).toThrow();
    expect(() => gateway.resolveListenConfig({ env, argv: [] })).toThrow();
    expect(() => launcher(env)).toThrow();
    expect(() => owner({ ...env })).toThrow();
    const old = process.env.PORT;
    try {
      process.env.PORT = env.PORT;
      expect(() => resolveServerHost()).toThrow();
    } finally {
      if (old === undefined) delete process.env.PORT;
      else process.env.PORT = old;
    }
  });
});
