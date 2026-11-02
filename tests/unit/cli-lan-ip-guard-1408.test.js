import fs from "node:fs";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

const cliSource = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const fnSource = cliSource.match(/function getLanIp\(\) \{[\s\S]*?\n\}\n/)[0];

function run(networkInterfaces) {
  return vm.runInNewContext(`${fnSource}; getLanIp()`, { os: { networkInterfaces } });
}

describe("CLI getLanIp guard (#1408)", () => {
  it("returns first external IPv4 address", () => {
    expect(run(() => ({ lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }], en0: [{ family: "IPv4", internal: false, address: "10.0.0.5" }] }))).toBe("10.0.0.5");
  });

  it("returns null when no external address exists", () => {
    expect(run(() => ({}))).toBeNull();
  });

  it("returns undefined when interface enumeration throws", () => {
    expect(run(() => { throw new Error("uv_interface_addresses failed"); })).toBeUndefined();
  });

  it("prints an explicit unknown-binding warning instead of staying silent", () => {
    expect(cliSource).toMatch(/lanIp === undefined\)[^\n]*binding address is unknown/);
  });
});
