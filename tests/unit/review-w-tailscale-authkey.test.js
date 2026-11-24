import { expect, it } from "vitest";
import {
  assertTailscalePkgSignature,
  buildTailscaleUpArgs,
} from "../../src/lib/tunnel/tailscale/tailscale.js";

const GOOD_SIGNATURE = `Package "tailscale.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Certificate Chain:
    1. Developer ID Installer: Tailscale Inc. (W5364U7YZB)
    2. Developer ID Certification Authority
    3. Apple Root CA
`;

it("uses a file reference for login auth keys, keeping the secret out of argv", () => {
  const args = buildTailscaleUpArgs("router", "/private/tailscale-authkey/authkey");
  expect(args).toContain("--auth-key=file:/private/tailscale-authkey/authkey");
  expect(args.join(" ")).not.toContain("secret-key");
});

it("accepts only the expected Apple signed Tailscale installer identity", () => {
  expect(() => assertTailscalePkgSignature(GOOD_SIGNATURE)).not.toThrow();
  expect(() => assertTailscalePkgSignature(GOOD_SIGNATURE.replace(
    "signed by a developer certificate issued by Apple for distribution",
    "signed by untrusted certificate",
  ))).toThrow(/signature/);
  expect(() => assertTailscalePkgSignature(GOOD_SIGNATURE.replace("W5364U7YZB", "FAKE000000"))).toThrow(/signature/);
});
