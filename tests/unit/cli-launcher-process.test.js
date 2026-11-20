import { createServer } from "node:net";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { canBindLauncherPort } = require("../../cli/src/cli/utils/launcherProcess.js");

describe("launcher cleanup probe", () => {
  it("detects an occupied port and releases its own probe socket", async () => {
    const host = "127.0.0.1";
    const server = createServer();
    await new Promise((resolve) => server.listen(0, host, resolve));
    const { port } = server.address();
    try {
      await expect(canBindLauncherPort(port, host)).resolves.toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await expect(canBindLauncherPort(port, host)).resolves.toBe(true);
    await expect(canBindLauncherPort(port, host)).resolves.toBe(true);
  });
});
