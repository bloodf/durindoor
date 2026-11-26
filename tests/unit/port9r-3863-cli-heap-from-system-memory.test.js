import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildNodeArgs } = require("../../cli/hooks/nodeFlags.js");
const cliSource = readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");

const MIB = 1024 * 1024;
const heapArgs = (env, totalMemoryMb) => buildNodeArgs("/app/server.js", env, totalMemoryMb * MIB)
  .filter((arg) => arg.startsWith("--max-old-space-size="));

describe("9router #3863 (d6c08f76276e): CLI default heap from system memory", () => {
  it.each([
    [512, 512],
    [1024, 768],
    [4096, 3072],
    [7800, 5850],
    [8192, 6144],
    [65536, 6144],
  ])("sizes a %i MB host at %i MB", (totalMb, heapMb) => {
    expect(heapArgs({}, totalMb)).toEqual([`--max-old-space-size=${heapMb}`]);
  });

  it("uses the sized default after an invalid dedicated value", () => {
    expect(heapArgs({ NINEROUTER_MAX_OLD_SPACE_SIZE: "large" }, 4096))
      .toEqual(["--max-old-space-size=3072"]);
  });

  it("leaves operator heap settings alone on a small host", () => {
    expect(heapArgs({ NINEROUTER_MAX_OLD_SPACE_SIZE: "8192" }, 2048))
      .toEqual(["--max-old-space-size=8192"]);
    expect(heapArgs({ NINEROUTER_MAX_OLD_SPACE_SIZE: "0" }, 2048)).toEqual([]);
    expect(heapArgs({ NODE_OPTIONS: "--max-old-space-size=4096" }, 2048)).toEqual([]);
  });

  it("passes this host's memory from the launcher", () => {
    expect(cliSource).toContain("nodeFlags.buildNodeArgs(entry, env, os.totalmem())");
  });
});
