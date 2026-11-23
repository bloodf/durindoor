import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = fs.readFileSync(path.join(repoRoot, "src/lib/tunnel/tailscale/tailscale.js"), "utf8");

const SIGNED_OUTPUT = `Package "tailscale.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Notarization: trusted by the Apple notary service
   Signed with a trusted timestamp on: 2026-01-01 00:00:00 +0000
   Certificate Chain:
    1. Developer ID Installer: Tailscale Inc. (W5364U7YZB)
       Expires: 2030-01-01 00:00:00 +0000
    2. Developer ID Certification Authority
    3. Apple Root CA
`;

describe("#2213 Tailscale installer downloads are verified before running as root", () => {
  it("macOS: downloads into a mkdtemp dir with an exclusive create and checks the pkg signature", () => {
    expect(source).toContain('mkdtempSync(path.join(os.tmpdir(), "tailscale-pkg-"))');
    expect(source).toContain('openSync(destPath, "wx", 0o600)');
    expect(source).not.toContain('path.join(os.tmpdir(), "tailscale.pkg")');
    expect(source).toContain("pkgutil");
    expect(source).toContain("--check-signature");
    expect(source.indexOf("verifyTailscalePkgSignature(pkgPath)")).toBeLessThan(
      source.indexOf('["-S", "installer"')
    );
  });

  it("macOS: accepts only a signed package whose leaf is the Tailscale Developer ID", async () => {
    const { assertTailscalePkgSignature } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    expect(() => assertTailscalePkgSignature(SIGNED_OUTPUT)).not.toThrow();
    expect(() => assertTailscalePkgSignature("Package \"x.pkg\":\n   Status: no signature\n")).toThrow(/signature/);
    expect(() => assertTailscalePkgSignature(
      SIGNED_OUTPUT.replace("Tailscale Inc.", "Evil Corp")
    )).toThrow(/signature/);
    expect(() => assertTailscalePkgSignature(
      SIGNED_OUTPUT.replace("Status: signed", "Status: untrusted")
    )).toThrow(/signature/);
    expect(() => assertTailscalePkgSignature(undefined)).toThrow(/signature/);
  });

  it("Linux: pins the install script SHA-256 and refuses a mismatching script", async () => {
    const { TAILSCALE_INSTALL_SCRIPT_SHA256, verifyTailscaleInstallScript } = await import(
      "../../src/lib/tunnel/tailscale/tailscale.js"
    );
    expect(TAILSCALE_INSTALL_SCRIPT_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyTailscaleInstallScript(Buffer.from("#!/bin/sh\nrm -rf /\n"))).toThrow(/SHA-256 mismatch/);
    expect(source.indexOf("verifyTailscaleInstallScript(scriptContent)")).toBeLessThan(
      source.indexOf('["-S", "sh", tmpScript]')
    );
  });

  it("Linux: writes the script into a private mkdtemp dir, not a predictable tmpdir file", () => {
    expect(source).toContain('mkdtempSync(path.join(os.tmpdir(), "tailscale-install-"))');
    expect(source).toContain('flag: "wx"');
    expect(source).not.toMatch(/tailscale-install-\$\{crypto\.randomBytes/);
  });

  it("Windows: verifies the MSI Authenticode signature before running msiexec", async () => {
    const { WINDOWS_MSI_SIGNATURE_SCRIPT } = await import("../../src/lib/tunnel/tailscale/tailscale.js");
    expect(WINDOWS_MSI_SIGNATURE_SCRIPT).toContain("Get-AuthenticodeSignature");
    expect(WINDOWS_MSI_SIGNATURE_SCRIPT).toContain("'Valid'");
    expect(WINDOWS_MSI_SIGNATURE_SCRIPT).toContain("Tailscale Inc");
    expect(source).toContain('mkdtempSync(path.join(os.tmpdir(), "tailscale-msi-"))');
    expect(source).not.toContain('path.join(os.tmpdir(), "tailscale-setup.msi")');
    expect(source.indexOf("WINDOWS_MSI_SIGNATURE_SCRIPT], {")).toBeLessThan(
      source.indexOf("Start-Process msiexec")
    );
  });

  it("keeps the trusted-sudo boundary", () => {
    expect(source).toContain('resolveTrustedUnixBinary("sudo")');
    expect(source).not.toMatch(/spawn\(["']sudo["']/);
  });
});
