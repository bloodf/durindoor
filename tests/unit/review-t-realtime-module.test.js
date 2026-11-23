import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const server = require(path.join(root, "custom-server.js"));
const realtime = require(path.join(root, "realtime-upgrade.cjs"));

describe("realtime upgrade module extraction", () => {
  it("custom-server re-exports the realtime module functions", () => {
    expect(server.handleRealtimeUpgrade).toBe(realtime.handleRealtimeUpgrade);
    expect(server.installRealtimeUpgradeDispatcher).toBe(realtime.installRealtimeUpgradeDispatcher);
  });

  it("standalone build copies realtime-upgrade.cjs beside custom-server.js", () => {
    const build = readFileSync(path.join(root, "scripts/build-app.mjs"), "utf8");
    expect(build).toContain('"realtime-upgrade.cjs"');
  });
});
