import fs from "node:fs";
import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { buildNodeArgs } = require("../../cli/hooks/nodeFlags.js");
const cliSource = fs.readFileSync(new URL("../../cli/cli.js", import.meta.url), "utf8");
const DNS_FLAG = "--dns-result-order=ipv4first";

describe("CLI IPv4-first DNS order (upstream #2699)", () => {
  it("places the DNS flag exactly once before heap flags", () => {
    const argv = buildNodeArgs("/app/server.js", {});

    expect(argv.filter((arg) => arg === DNS_FLAG)).toHaveLength(1);
    expect(argv.indexOf(DNS_FLAG)).toBeLessThan(argv.indexOf("--max-old-space-size=6144"));
  });

  it("keeps DNS ordering independent from disabled or external heap settings", () => {
    expect(buildNodeArgs("/app/server.js", { NINEROUTER_MAX_OLD_SPACE_SIZE: "0" }))
      .toEqual([DNS_FLAG, "/app/server.js"]);
    expect(buildNodeArgs("/app/server.js", { NODE_OPTIONS: "--max-old-space-size=4096" }))
      .toEqual([DNS_FLAG, "/app/server.js"]);
  });

  it("routes both server spawn sites through the DNS-enabled argv seam", () => {
    const spawnCalls = cliSource.match(/spawn\(RUNTIME, buildNodeArgs\(serverPath, process\.env\)/g) ?? [];
    const recoveryWorkerArgv = buildNodeArgs("/app/server.js", {});
    const normalServerArgv = buildNodeArgs("/app/server.js", {});

    expect(spawnCalls).toHaveLength(2);
    expect(recoveryWorkerArgv).toContain(DNS_FLAG);
    expect(normalServerArgv).toContain(DNS_FLAG);
  });

  it("passes the DNS flag explicitly to the detached tray child", () => {
    expect(cliSource).toContain(
      "spawn(process.execPath, [\"--dns-result-order=ipv4first\", __filename, \"--tray\"",
    );
  });

  it("does not restore the old hard-coded heap argument in cli.js", () => {
    expect(cliSource).not.toContain("--max-old-space-size=6144");
  });
});
