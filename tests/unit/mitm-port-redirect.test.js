import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const {
  buildLinuxRedirect,
  buildMacRedirect,
  buildWindowsRedirect,
  requireWindowsSid,
} = require("../../src/mitm/portRedirect.js");

describe("MITM owner-scoped redirect rules", () => {
  it("uses bounded, symmetric Linux UID rules", () => {
    const redirect = buildLinuxRedirect({ uid: 501, publicPort: 443, internalPort: 8443 });
    expect(redirect.install).toContain("iptables -w 5");
    expect(redirect.install).toContain("--uid-owner 501");
    expect(redirect.install).toContain("! --uid-owner 501");
    expect(redirect.install).toContain("--dports 443,8443");
    expect(redirect.remove).not.toContain("while ");
    expect(redirect.remove).toContain("DurinDoor MITM NAT rule remains installed");
  });

  it("loads a non-pass macOS redirect plus a user filter without enabling PF", () => {
    const redirect = buildMacRedirect({ uid: 501, publicPort: 443, internalPort: 8443 });
    expect(redirect.anchor).toBe("com.apple/durindoor.mitm.501");
    expect(redirect.install).toContain("rdr on lo0");
    expect(redirect.install).not.toContain("rdr pass");
    expect(redirect.install).toContain("user != 501");
    expect(redirect.install).not.toContain("pfctl -E");
    expect(redirect.remove).not.toContain("|| true");

    if (process.platform === "darwin") {
      const match = redirect.install.match(/printf '%s\\n' '([\s\S]+)' \| pfctl/);
      expect(match).not.toBeNull();
      const parsed = spawnSync("/sbin/pfctl", ["-vnf", "-"], {
        input: `${match[1]}\n`,
        encoding: "utf8",
      });
      expect(parsed.status, parsed.stderr).toBe(0);
    }
  });

  it("uses a Windows LocalUser firewall rule and never portproxy", () => {
    const redirect = buildWindowsRedirect({ sid: "S-1-5-21-123", publicPort: 443 });
    expect(redirect.install).toContain("New-NetFirewallRule");
    expect(redirect.install).toContain("-LocalUser");
    expect(redirect.install).toContain("127.0.0.1");
    expect(redirect.install).not.toContain("portproxy");
    expect(redirect.remove).toContain("removal could not be verified");
  });

  it("strictly validates the Windows owner SID", () => {
    expect(requireWindowsSid(() => "S-1-5-21-123\n")).toBe("S-1-5-21-123");
    expect(() => requireWindowsSid(() => "'; Remove-NetFirewallRule *\n")).toThrow(
      "safe Windows owner SID",
    );
  });
});
