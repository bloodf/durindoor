import { describe, expect, it } from "vitest";

import { defaultApiKeyConnectionName } from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyConnectionName.js";

describe("API-key connection default names", () => {
  it("uses main for the first connection", () => {
    expect(defaultApiKeyConnectionName(0)).toBe("main");
    expect(defaultApiKeyConnectionName(undefined)).toBe("main");
  });

  it("increments subsequent defaults to avoid name-based overwrites", () => {
    expect(defaultApiKeyConnectionName(1)).toBe("main-2");
    expect(defaultApiKeyConnectionName(2)).toBe("main-3");
  });
});
