import { describe, expect, it } from "vitest";

import { defaultApiKeyConnectionName, shouldResetAddApiKeyModal } from "../../src/app/(dashboard)/dashboard/providers/[id]/apiKeyConnectionName.js";

describe("API-key connection default names", () => {
  it("uses main for the first connection", () => {
    expect(defaultApiKeyConnectionName([])).toBe("main");
    expect(defaultApiKeyConnectionName(["custom"])).toBe("main");
  });

  it("increments subsequent defaults to avoid name-based overwrites", () => {
    expect(defaultApiKeyConnectionName(["main"])).toBe("main-2");
    expect(defaultApiKeyConnectionName(["main", "main-2"])).toBe("main-3");
  });

  it("uses the first unused main suffix for sparse or custom name sets", () => {
    expect(defaultApiKeyConnectionName(["main", "custom", "main-3"])).toBe("main-2");
    expect(defaultApiKeyConnectionName(["custom", "main-2", "main-3"])).toBe("main");
  });

  it("keeps count fallback for older callers", () => {
    expect(defaultApiKeyConnectionName(1)).toBe("main-2");
    expect(defaultApiKeyConnectionName(undefined)).toBe("main");
  });
});

describe("Add API-key modal reset guard", () => {
  it("resets only when the modal transitions from closed to open", () => {
    expect(shouldResetAddApiKeyModal(false, true)).toBe(true);
    expect(shouldResetAddApiKeyModal(true, true)).toBe(false);
    expect(shouldResetAddApiKeyModal(true, false)).toBe(false);
    expect(shouldResetAddApiKeyModal(false, false)).toBe(false);
  });
});
