import { describe, expect, it, vi } from "vitest";
import { parsePairing, preflightPermissions, runCapture, confirmationFor } from "../../extensions/provider-cookie-capture/capture.js";
const origin = "https://veoaifree.com";
const name = `wordpress_logged_in_${"c".repeat(32)}`;
const now = Date.now();
async function capture(entries, mode) {
  const plan = parsePairing(JSON.stringify({ provider: "veoaifree-web", token: `ddpair_${"a".repeat(43)}`, header: "x-durindoor-pairing-token", expiresAt: new Date(now + 60000).toISOString(), action: "create", name: "fixture", importUrl: "https://dashboard.example/api/providers/cookie-import", contract: { origin, cookieNames: [], hashedCookiePrefixes: ["wordpress_logged_in_"] } }), now).plan;
  plan.tabId = 7;
  const controller = new AbortController();
  let navigated = false;
  const getAll = vi.fn(async () => {
    if (mode === "reject") throw new Error("fixture");
    if (mode === "cancel") controller.abort();
    if (mode === "navigate") navigated = true;
    return entries;
  });
  const chrome = { tabs: { get: async () => ({ url: navigated ? "https://elsewhere.example" : origin }) }, permissions: { contains: async () => true }, cookies: { getAllCookieStores: async () => [{ id: "store", tabIds: [7] }], get: () => { throw new Error("unexpected get"); }, getAll } };
  await preflightPermissions(chrome, plan);
  const fetch = vi.fn(async () => ({ status: 201, json: async () => ({}) }));
  const result = await runCapture({ chrome, fetch, plan, confirmed: confirmationFor(plan), signal: controller.signal, now: () => now });
  expect(getAll).toHaveBeenCalledExactlyOnceWith({ url: origin + "/", storeId: "store" });
  return { result, fetch };
}
const cookie = (extra = {}) => ({ name, value: "private-fixture", domain: "veoaifree.com", secure: true, storeId: "store", ...extra });
describe("bounded hashed-family capture", () => {
  it("accepts arbitrary md5 and never reads nonmember values", async () => {
    const noise = { name: "wordpress_test_cookie", get value() { throw new Error("unrelated value read"); } };
    const { result, fetch } = await capture([noise, cookie()]);
    expect(result.ok).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body).cookies[0].name).toBe(name);
  });
  it.each([
    [[cookie({ secure: false })], "no_cookies"],
    [[cookie({ domain: "evil.example" })], "no_cookies"],
    [[cookie({ storeId: "other" })], "no_cookies"],
    [[cookie({ expirationDate: now / 1000 })], "no_cookies"],
    [[cookie({ name: name + "x" })], "no_cookies"],
    [[cookie(), cookie({ name: `wordpress_logged_in_${"d".repeat(32)}` })], "ambiguous_cookies"],
    [Array.from({ length: 65 }, () => cookie()), "no_cookies"],
    [{}, "no_cookies"],
  ])("refuses unsafe jar %#", async (entries, code) => {
    const { result, fetch } = await capture(entries);
    expect(result.code).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([["reject", "permission_denied"], ["cancel", "cancelled"], ["navigate", "tab_navigated"]])("refuses %s", async (mode, code) => {
    const { result, fetch } = await capture([cookie()], mode);
    expect(result.code).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
  });
});
