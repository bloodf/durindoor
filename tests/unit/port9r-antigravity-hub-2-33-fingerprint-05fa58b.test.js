import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../open-sse/providers/shared.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";

const require = createRequire(import.meta.url);
const mitm = require("../../src/mitm/antigravityIdeVersion.js");

// Port of 9router master 05fa58b8ce: Antigravity Hub fingerprint 2.24.0 -> 2.33.0 everywhere.
describe("port 9router 05fa58b8ce: Antigravity Hub 2.33.0 fingerprint", () => {
  it("pins the shared provider identity to Hub 2.33.0", () => {
    expect(ANTIGRAVITY_IDE_VERSION).toBe("2.33.0");
    expect(ANTIGRAVITY_IDE_USER_AGENT).toBe("antigravity/hub/2.33.0 darwin/arm64");
  });

  it("keeps the MITM generation override on the same version", () => {
    expect(mitm.ANTIGRAVITY_IDE_VERSION).toBe(ANTIGRAVITY_IDE_VERSION);
    const bodyBuffer = Buffer.from(JSON.stringify({ metadata: { ideName: "antigravity", ideVersion: "2.11.0" } }));
    const out = mitm.applyAntigravityIdeVersionOverride(bodyBuffer, { "user-agent": "antigravity/2.11.0" }, "/v1internal:streamGenerateContent");
    expect(JSON.parse(out.bodyBuffer.toString()).metadata.ideVersion).toBe("2.33.0");
  });

  it("reuses the shared identity for the live account catalog", () => {
    expect(PROVIDER_MODELS_CONFIG.antigravity.headers).toMatchObject({
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
      "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
    });
  });
});
