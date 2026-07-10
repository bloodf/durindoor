import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createPeerOwnerVerifier,
  parseLsofOwner,
  parseProcTcpOwner,
} = require("../../src/mitm/peerOwner.js");

describe("MITM peer process ownership", () => {
  it("matches only the owner UID and exact Linux loopback tuple", () => {
    const fixture = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 0100007F:C350 0100007F:20FB 01 00000000:00000000 00:00000000 00000000   501 0 12345",
    ].join("\n");
    expect(parseProcTcpOwner(fixture, {
      clientPort: 50000,
      targetPorts: [443, 8443],
      ownerUid: 501,
    })).toBe(true);
    expect(parseProcTcpOwner(fixture, {
      clientPort: 50000,
      targetPorts: [443, 8443],
      ownerUid: 502,
    })).toBe(false);
  });

  it("matches the client-side macOS lsof record, not another user", () => {
    const fixture = [
      "p111",
      "u502",
      "n127.0.0.1:50000->127.0.0.1:443",
      "p222",
      "u501",
      "n127.0.0.1:50000->127.0.0.1:443",
    ].join("\n");
    expect(parseLsofOwner(fixture, {
      clientPort: 50000,
      targetPorts: [443, 8443],
      ownerUid: 501,
    })).toBe(true);
    expect(parseLsofOwner(fixture, {
      clientPort: 50000,
      targetPorts: [443, 8443],
      ownerUid: 503,
    })).toBe(false);
  });

  it("fails closed for a different Linux UID and caches an accepted socket", async () => {
    const readFile = vi.fn(() => [
      "header",
      "0: 0100007F:C350 0100007F:01BB 01 0:0 0:0 0 501 0 1",
    ].join("\n"));
    const verify = createPeerOwnerVerifier({
      platform: "linux",
      processImpl: { geteuid: () => 501 },
      readFile,
      targetPorts: [443, 8443],
    });
    const socket = {
      localAddress: "127.0.0.1",
      remoteAddress: "127.0.0.1",
      remotePort: 50000,
    };
    await expect(verify(socket)).resolves.toBe(true);
    await expect(verify(socket)).resolves.toBe(true);
    expect(readFile).toHaveBeenCalledOnce();
  });

  it("uses a bounded SID ownership query on Windows", async () => {
    const execText = vi.fn(async (command, args) => {
      expect(command).toBe("C:\\Windows\\System32\\powershell.exe");
      expect(args).toContain("-EncodedCommand");
      return "verified";
    });
    const verify = createPeerOwnerVerifier({
      platform: "win32",
      execText,
      targetPorts: [443],
    });
    await expect(verify({
      localAddress: "127.0.0.1",
      remoteAddress: "::ffff:127.0.0.1",
      remotePort: 50001,
    })).resolves.toBe(true);
    expect(execText).toHaveBeenCalledOnce();
  });

  it("rejects non-loopback peers before invoking platform discovery", async () => {
    const execText = vi.fn();
    const verify = createPeerOwnerVerifier({ platform: "darwin", execText });
    await expect(verify({
      localAddress: "127.0.0.1",
      remoteAddress: "192.0.2.4",
      remotePort: 50002,
    })).resolves.toBe(false);
    expect(execText).not.toHaveBeenCalled();
  });
});
