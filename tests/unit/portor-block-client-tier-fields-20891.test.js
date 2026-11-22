import { describe, expect, it } from "vitest";
import { CLIENT_TIER_FIELDS, stripClientTierFields } from "../../open-sse/handlers/chatCore/clientTierFieldStrip.js";

const fullBody = () => ({
  model: "gpt-6.2-sol",
  service_tier: "priority",
  safety_identifier: "user-1",
  inference_geo: "us",
  speed: "fast",
  include_obfuscation: true,
  input: "hi"
});

describe("blockClientTierFields (port of OmniRoute #20891)", () => {
  it("removes every client tier/identity field when the connection opts in", () => {
    const body = stripClientTierFields(fullBody(), { blockClientTierFields: true });
    for (const field of CLIENT_TIER_FIELDS) expect(body).not.toHaveProperty(field);
    expect(body).toMatchObject({ model: "gpt-6.2-sol", input: "hi" });
  });

  it("is off by default and for non-true values", () => {
    for (const psd of [undefined, null, {}, { blockClientTierFields: false }, { blockClientTierFields: "true" }]) {
      expect(stripClientTierFields(fullBody(), psd)).toEqual(fullBody());
    }
  });

  it("tolerates non-object bodies", () => {
    expect(stripClientTierFields(null, { blockClientTierFields: true })).toBeNull();
  });
});
