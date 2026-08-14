import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { isUsingDefaultPassword, DEFAULT_PASSWORD } from "../../src/lib/auth/dashboardSession.js";

const storedHash = bcrypt.hashSync(DEFAULT_PASSWORD, 4);
const customHash = bcrypt.hashSync("operator-secret", 4);

describe("isUsingDefaultPassword", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("treats a missing password source as the built-in default", async () => {
    expect(await isUsingDefaultPassword({})).toBe(true);
    expect(await isUsingDefaultPassword({ password: "" })).toBe(true);
  });

  it("recognises a stored hash of the built-in password as the default", async () => {
    expect(await isUsingDefaultPassword({ password: storedHash })).toBe(true);
  });

  it("recognises a stored hash of a custom password as not the default", async () => {
    expect(await isUsingDefaultPassword({ password: customHash })).toBe(false);
  });

  it("recognises INITIAL_PASSWORD set to the built-in password as the default", async () => {
    vi.stubEnv("INITIAL_PASSWORD", DEFAULT_PASSWORD);
    expect(await isUsingDefaultPassword({})).toBe(true);
  });

  it("recognises INITIAL_PASSWORD set to a custom value as not the default", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    expect(await isUsingDefaultPassword({})).toBe(false);
  });

  it("prefers the stored password over INITIAL_PASSWORD when both are set", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    expect(await isUsingDefaultPassword({ password: storedHash })).toBe(true);
  });
});
