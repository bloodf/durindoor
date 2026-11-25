import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildNodeArgs } = require("../../cli/hooks/nodeFlags.js");

// Exercise Node itself with launcher-generated arguments, without starting the server.
function heapLimit(env) {
  const args = buildNodeArgs("-e", env);
  const result = spawnSync(process.execPath, [
    ...args,
    'process.stdout.write(String(require("node:v8").getHeapStatistics().heap_size_limit))',
  ], { env: { NODE_OPTIONS: env.NODE_OPTIONS || "" }, encoding: "utf8", timeout: 10_000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return Number(result.stdout);
}

describe("runtime heap compatibility (#1143)", () => {
  it("honors NODE_OPTIONS unless the launcher receives an explicit cap", () => {
    const fromNodeOptions = heapLimit({ NODE_OPTIONS: "--max-old-space-size=128" });
    const explicit = heapLimit({ NODE_OPTIONS: "--max-old-space-size=128", NINEROUTER_MAX_OLD_SPACE_SIZE: "256" });
    const disabled = heapLimit({ NODE_OPTIONS: "--max-old-space-size=128", NINEROUTER_MAX_OLD_SPACE_SIZE: "0" });
    expect(fromNodeOptions).toBeGreaterThan(128 * 1024 * 1024);
    expect(explicit - fromNodeOptions).toBe(128 * 1024 * 1024);
    expect(disabled).toBe(fromNodeOptions);
  });
});
