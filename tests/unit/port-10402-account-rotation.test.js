import { describe, expect, it } from "vitest";
import {
  pickAccount,
  markCooldown,
  markSuccess,
  maskAccountId,
  isNetworkErrorRotatable,
  isAccountReady,
} from "../../open-sse/executors/accountRotation.js";

const baseAccount = (overrides = {}) => ({
  fingerprint: "fp-12345678",
  proxy: null,
  consecutiveFails: 0,
  cooldownUntil: 0,
  ...overrides,
});

describe("port-10402 accountRotation: pickAccount", () => {
  it("round-robins through ready accounts and advances nextAccountIdx", () => {
    const accounts = [baseAccount(), baseAccount(), baseAccount()];
    const state = { nextAccountIdx: 0 };

    const first = pickAccount(accounts, state);
    const second = pickAccount(accounts, state);
    const third = pickAccount(accounts, state);
    const fourth = pickAccount(accounts, state);

    expect(first).toBe(accounts[0]);
    expect(second).toBe(accounts[1]);
    expect(third).toBe(accounts[2]);
    expect(fourth).toBe(accounts[0]);
    expect(state.nextAccountIdx).toBe(1);
  });

  it("skips accounts still in cooldown and picks the next ready one", () => {
    const accounts = [
      baseAccount({ cooldownUntil: Date.now() + 60_000 }),
      baseAccount(),
      baseAccount(),
    ];
    const state = { nextAccountIdx: 0 };

    const picked = pickAccount(accounts, state);
    expect(picked).toBe(accounts[1]);
    expect(state.nextAccountIdx).toBe(2);
  });

  it("falls back to current index when no account is ready", () => {
    const farFuture = Date.now() + 60_000;
    const accounts = [
      baseAccount({ cooldownUntil: farFuture }),
      baseAccount({ cooldownUntil: farFuture }),
    ];
    const state = { nextAccountIdx: 0 };

    const picked = pickAccount(accounts, state);
    expect(picked).toBe(accounts[0]);
  });

  it("uses custom isReady predicate when provided", () => {
    const accounts = [
      baseAccount({ fingerprint: "a" }),
      baseAccount({ fingerprint: "b" }),
    ];
    const state = { nextAccountIdx: 0 };
    const onlyB = (acct) => acct.fingerprint === "b";

    const picked = pickAccount(accounts, state, onlyB);
    expect(picked).toBe(accounts[1]);
  });
});

describe("port-10402 accountRotation: markCooldown", () => {
  it("applies exponential backoff bounded by COOLDOWN_MAX_MS", () => {
    const account = baseAccount();

    markCooldown(account);
    expect(account.consecutiveFails).toBe(1);
    const firstCooldown = account.cooldownUntil - Date.now();
    expect(firstCooldown).toBeGreaterThan(0);
    expect(firstCooldown).toBeLessThan(35_000);

    markCooldown(account);
    markCooldown(account);
    markCooldown(account);
    markCooldown(account);
    markCooldown(account);
    markCooldown(account);
    expect(account.consecutiveFails).toBe(7);
    const capped = account.cooldownUntil - Date.now();
    expect(capped).toBeLessThan(65_000);
  });

  it("flips isAccountReady to false after marking", () => {
    const account = baseAccount();
    markCooldown(account);
    expect(isAccountReady(account)).toBe(false);
  });
});

describe("port-10402 accountRotation: markSuccess", () => {
  it("resets consecutiveFails to zero", () => {
    const account = baseAccount({ consecutiveFails: 4 });
    markSuccess(account);
    expect(account.consecutiveFails).toBe(0);
  });
});

describe("port-10402 accountRotation: maskAccountId", () => {
  it("returns the first 8 chars of the fingerprint plus ellipsis", () => {
    expect(maskAccountId("abcdef1234567890")).toBe("abcdef12…");
  });

  it("returns the full string unmasked when 8 chars or shorter", () => {
    expect(maskAccountId("abc")).toBe("abc…");
  });
});

describe("port-10402 accountRotation: isNetworkErrorRotatable", () => {
  it("rotates only when account has a dedicated proxy", () => {
    expect(isNetworkErrorRotatable(baseAccount({ proxy: null }))).toBe(false);
    expect(isNetworkErrorRotatable(baseAccount({ proxy: "socks5://x" }))).toBe(
      true,
    );
  });
});
