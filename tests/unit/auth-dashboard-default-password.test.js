import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import { invalidateDefaultPasswordCache, isUsingDefaultPassword, DEFAULT_PASSWORD } from "../../src/lib/auth/dashboardSession.js";

const storedHash = bcrypt.hashSync(DEFAULT_PASSWORD, 4);
const customHash = bcrypt.hashSync("operator-secret", 4);

describe("isUsingDefaultPassword", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    invalidateDefaultPasswordCache();
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

  it("drops the cached decision when a password changes", async () => {
    expect(await isUsingDefaultPassword({ password: storedHash })).toBe(true);
    invalidateDefaultPasswordCache();
    expect(await isUsingDefaultPassword({ password: customHash })).toBe(false);
  });

  it("recomputes when the stored password hash changes without cache invalidation", async () => {
    expect(await isUsingDefaultPassword({ password: storedHash })).toBe(true);
    expect(await isUsingDefaultPassword({ password: customHash })).toBe(false);
  });

  it("recomputes when INITIAL_PASSWORD changes without cache invalidation", async () => {
    vi.stubEnv("INITIAL_PASSWORD", DEFAULT_PASSWORD);
    expect(await isUsingDefaultPassword({})).toBe(true);
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    expect(await isUsingDefaultPassword({})).toBe(false);
  });

  it("only runs bcrypt.compare once when many concurrent callers race a cold cache", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    const results = await Promise.all([
      isUsingDefaultPassword({ password: storedHash }),
      isUsingDefaultPassword({ password: storedHash }),
      isUsingDefaultPassword({ password: storedHash }),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("recomputes after a rejected compute instead of sticking on a stale answer", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    spy.mockRejectedValueOnce(new Error("compare failed"));
    await expect(isUsingDefaultPassword({ password: storedHash })).rejects.toThrow("compare failed");
    spy.mockImplementationOnce(async () => true);
    await expect(isUsingDefaultPassword({ password: storedHash })).resolves.toBe(true);
    spy.mockRestore();
  });
});
