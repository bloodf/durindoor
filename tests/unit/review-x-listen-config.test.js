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
  const end = cliSource.indexOf("// Launcher options", start);
  // Run the CLI's own import line so the test sees which default host it binds.
  const binding = cliSource.match(/^const \{[^}]*\} = require\(listenConfigPath\);$/m)[0];
  const context = { args, process: { env, stdin: { isTTY: true }, exit: () => { throw new Error("launcher rejected port"); } }, console: { error() {} },
    listenConfigPath: "listenConfig",
    require: () => ({ ...shared, resolveListenConfig: (options) => shared.resolveListenConfig({ ...options, env }) }) };
  return vm.runInNewContext(`${binding}\n${cliSource.slice(start, end)}\nconst { port, host } = parseArgsOrExit(args);\n({ port, host, DEFAULT_HOST })`, context);
}

function withProcessEnv(env, run) {
  const old = { PORT: process.env.PORT, HOSTNAME: process.env.HOSTNAME };
  try {
    for (const key of Object.keys(old)) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return run();
  } finally {
    for (const key of Object.keys(old)) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
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
  it("uses the same environment for the gateway, owner and guard", () => {
    const env = { PORT: "23456", HOSTNAME: "192.0.2.1" };
    const expected = { port: 23456, host: "192.0.2.1" };
    expect(shared.resolveListenConfig({ env, argv: [] })).toEqual(expected);
    expect(gateway.resolveListenConfig({ env, argv: [] })).toEqual(expected);
    expect(owner({ ...env })).toEqual(expected);
    expect(withProcessEnv(env, resolveServerHost)).toBe(expected.host);
  });

  it("defaults the server entries to 127.0.0.1", () => {
    const expected = { port: 20128, host: "127.0.0.1" };
    expect(shared.DEFAULT_SERVER_HOST).toBe(expected.host);
    expect(shared.resolveListenConfig({ env: {}, argv: [] })).toEqual(expected);
    expect(gateway.resolveListenConfig({ env: {}, argv: [] })).toEqual(expected);
    expect(owner({})).toEqual(expected);
    expect(withProcessEnv({}, resolveServerHost)).toBe(expected.host);
  });

  it("defaults the CLI to 0.0.0.0, ignoring HOSTNAME but reading PORT", () => {
    expect(shared.DEFAULT_CLI_HOST).toBe("0.0.0.0");
    const expected = { port: 20128, host: "0.0.0.0", DEFAULT_HOST: "0.0.0.0" };
    expect(launcher({})).toEqual(expected);
    expect(launcher({ PORT: "23456", HOSTNAME: "192.0.2.1" })).toEqual({ ...expected, port: 23456 });
    expect(launcher({}, ["--host"])).toEqual(expected);
    expect(launcher({}, ["--host", "127.0.0.1"])).toEqual({ ...expected, host: "127.0.0.1" });
  });

  it.each(["0", "65536", "not-a-port"])("rejects the environment port %s in each entry", (port) => {
    const env = { PORT: port };
    expect(() => shared.resolveListenConfig({ env, argv: [] })).toThrow("Invalid server port");
    expect(() => gateway.resolveListenConfig({ env, argv: [] })).toThrow("Invalid server port");
    expect(() => launcher(env)).toThrow("launcher rejected port");
    expect(() => owner({ ...env })).toThrow("Invalid server port");
    expect(() => withProcessEnv(env, resolveServerHost)).toThrow("Invalid server port");
  });

  it.each(["0", "65536", "not-a-port"])("rejects the CLI flag --port %s", (port) => {
    expect(() => launcher({}, ["--port", port])).toThrow("launcher rejected port");
  });
});
