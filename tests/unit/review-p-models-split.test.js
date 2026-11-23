import { describe, expect, it } from "vitest";
import { readCompatibleContextLength } from "../../src/app/api/v1/models/buildModelsList.js";

describe("model list split on current main", () => {
  it("preserves the compatible runtime context helper in the public API", () => {
    expect(readCompatibleContextLength({ loaded_context_length: 8192 })).toBe(8192);
    expect(readCompatibleContextLength({ max_context_length: 65536 })).toBeNull();
  });
});
