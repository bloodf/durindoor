import { describe, expect, it } from "vitest";

import {
  buildImportTokenPayload,
  isImportTokenOAuthProvider,
} from "../../src/shared/utils/importTokenProviders.js";

describe("import-token OAuth providers", () => {
  it("no longer routes grok-cli through import-token (it is a device-code provider)", () => {
    expect(isImportTokenOAuthProvider("grok-cli")).toBe(false);
    expect(isImportTokenOAuthProvider("claude")).toBe(false);
  });

  it("keeps raw JWT input as a JSON string body", () => {
    expect(buildImportTokenPayload("  eyJ.token.sig  ")).toBe("eyJ.token.sig");
  });

  it("parses pasted auth JSON unchanged", () => {
    const payload = buildImportTokenPayload(`{
      "https://auth.x.ai::client": {
        "key": "eyJ.token.sig",
        "refresh_token": "refresh-1"
      }
    }`);

    expect(payload["https://auth.x.ai::client"].key).toBe("eyJ.token.sig");
    expect(payload["https://auth.x.ai::client"].refresh_token).toBe("refresh-1");
  });
});
