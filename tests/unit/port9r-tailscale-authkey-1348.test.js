import { expect, it } from "vitest";
import { buildTailscaleUpArgs } from "../../src/lib/tunnel/tailscale/tailscale.js";

it("passes an auth key file reference to Tailscale login", () => {
  expect(buildTailscaleUpArgs("router", "/private/tailscale-authkey/authkey")).toEqual(
    expect.arrayContaining(["up", "--accept-routes", "--hostname=router", "--auth-key=file:/private/tailscale-authkey/authkey"]),
  );
  expect(buildTailscaleUpArgs(undefined)).not.toContain("--auth-key=");
});
