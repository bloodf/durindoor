/**
 * copilot-m365-web credential shape validation (no network).
 * grok-web / copilot-web / zenmux-free / perplexity-web probes are covered against the real
 * routes in web-session-probe-skip-14818.test.js (the old copies of route logic asserted
 * conversation-creating probes that no longer exist).
 */

import { describe, it, expect } from "vitest";
import { resolveConnectionParams } from "../../open-sse/executors/copilot-m365-connection.js";

function validateCopilotM365Web(apiKey, providerSpecificData = {}) {
  const params = resolveConnectionParams({ apiKey, providerSpecificData });
  const valid = !("error" in params);
  return {
    valid,
    error: valid ? null : params.error,
  };
}

describe("copilot web validation", () => {
  it("copilot-m365-web requires access_token and Chathub path", () => {
    expect(validateCopilotM365Web("access_token=tok; chathubPath=user@tenant")).toEqual({
      valid: true,
      error: null,
    });
    expect(validateCopilotM365Web(
      "wss://substrate.office.com/m365Copilot/Chathub/user%40tenant?access_token=tok",
    ).valid).toBe(true);
    expect(validateCopilotM365Web("access_token=tok").valid).toBe(false);
    expect(validateCopilotM365Web("chathubPath=user@tenant").valid).toBe(false);
    expect(validateCopilotM365Web("userTenant=user@tenant").valid).toBe(false);
    expect(validateCopilotM365Web("access_token=tok; chathubPath=user@tenant?junk").valid).toBe(false);
    expect(validateCopilotM365Web(
      "access_token=tok; chathubPath=user@tenant",
      { host: "attacker.example" },
    ).valid).toBe(false);
  });
});
