import { expect, it } from "vitest";
import { validatedRefreshUpdates } from "../../src/shared/services/providerCredentials.js";

it("rejects an invalid field before producing any persistence update", () => {
  expect(() => validatedRefreshUpdates({}, {
    accessToken: "new", refreshToken: "bad\nsecret"
  })).toThrow();
});

it("preserves validated replacement tokens", () => {
  expect(validatedRefreshUpdates({}, {
    accessToken: "new", refreshToken: "replacement"
  })).toMatchObject({ accessToken: "new", refreshToken: "replacement" });
});
