import { expect, it } from "vitest";
import { buildTailscaleUpArgs } from "../../src/lib/tunnel/tailscale/tailscale.js";

it("passes a configured authentication key to Tailscale login", () => {
  expect(buildTailscaleUpArgs("router", { TAILSCALE_AUTHKEY: " test-key " })).toEqual(
    expect.arrayContaining(["up", "--accept-routes", "--hostname=router", "--auth-key=test-key"]),
  );
  expect(buildTailscaleUpArgs(undefined, {})).not.toContain("--auth-key=");
});
