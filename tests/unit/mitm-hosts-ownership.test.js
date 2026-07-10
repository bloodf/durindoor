import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  buildWindowsHostsMutationScript,
  commitUnixHostsAndFlush,
  lineHasLegacyOwnedHost,
  lineHasOwnedHost,
  mutateUnixHosts,
} = require("../../src/mitm/dns/dnsConfig.js");

describe("MITM hosts ownership", () => {
  const host = "generativelanguage.googleapis.com";

  it("recognizes only an exact, single-host DurinDoor-owned line", () => {
    expect(lineHasOwnedHost(
      `127.0.0.1 ${host} # durindoor-mitm:antigravity`,
      host,
      "antigravity",
    )).toBe(true);
    expect(lineHasOwnedHost(`127.0.0.1 ${host}`, host, "antigravity")).toBe(false);
    expect(lineHasOwnedHost(
      `127.0.0.1 ${host} foreign.example # durindoor-mitm:antigravity`,
      host,
      "antigravity",
    )).toBe(false);
    expect(lineHasOwnedHost(
      `127.0.0.1 ${host} # operator-note`,
      host,
      "antigravity",
    )).toBe(false);
  });

  it("adopts or removes only the exact two-field legacy mapping", () => {
    expect(lineHasLegacyOwnedHost(`127.0.0.1 ${host}`, host)).toBe(true);
    expect(lineHasLegacyOwnedHost(`127.0.0.1 ${host} foreign.example`, host)).toBe(false);
    expect(lineHasLegacyOwnedHost(`127.0.0.1 ${host} # old override`, host)).toBe(false);
    expect(lineHasLegacyOwnedHost(`::1 ${host}`, host)).toBe(false);
  });

  it("uses the same exact ownership predicate in Windows removal", () => {
    const script = buildWindowsHostsMutationScript({
      action: "remove",
      hosts: [host],
      tag: "antigravity",
      hostsFile: "C:\\Windows\\System32\\drivers\\etc\\hosts",
      expectedSha256: "a".repeat(64),
    });

    expect(script).toContain("$fields.Count -eq 2");
    expect(script).toContain("$fields[1] -eq $hostName");
    expect(script).toContain("Test-OwnedHostLine $line $_.Host $_.Tag");
    expect(script).toContain("Hosts file changed before mutation");
    expect(script).toContain("Hosts file changed during mutation");
    expect(script).not.toContain("-not ($entries | Where-Object { Test-ExactHostLine");
  });

  it("binds a Unix mutation to the snapshot used to compute the next content", async () => {
    const original = Buffer.from(`127.0.0.1 localhost\n`);
    const snapshot = {
      bytes: original,
      sha256: crypto.createHash("sha256").update(original).digest("hex"),
    };
    const execute = vi.fn(async () => {});

    await mutateUnixHosts(
      `127.0.0.1 localhost\n127.0.0.1 ${host} # durindoor-mitm:antigravity\n`,
      "fixture-password",
      snapshot,
      execute,
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toContain(snapshot.sha256);
  });

  it("rolls back the exact Unix hosts commit when DNS cache flush fails", async () => {
    const original = Buffer.from("127.0.0.1 localhost\n");
    const next = `127.0.0.1 localhost\n127.0.0.1 ${host} # durindoor-mitm:antigravity\n`;
    const snapshot = {
      bytes: original,
      sha256: crypto.createHash("sha256").update(original).digest("hex"),
    };
    const mutate = vi.fn(async () => true);
    const flushError = new Error("mDNSResponder unavailable");

    await expect(commitUnixHostsAndFlush(next, "fixture-password", snapshot, {
      mutate,
      flush: vi.fn(async () => { throw flushError; }),
    })).rejects.toBe(flushError);

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1][0]).toBe(original.toString("utf8"));
    expect(mutate.mock.calls[1][2].sha256).toBe(
      crypto.createHash("sha256").update(next).digest("hex"),
    );
  });
});
