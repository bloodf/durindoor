import { describe, expect, it } from "vitest";
import { parseCookieString } from "../../open-sse/services/browserPool.js";

describe("upstream PR #5327 - __Host- cookies in browser pool sessions", () => {
  it.each([".example.com", "example.com"])("keeps __Host- cookies host-only for cookie domain %s", (domain) => {
    const [host, session] = parseCookieString("__Host-token=a=b; session=c", domain);
    expect(host).toMatchObject({ name: "__Host-token", value: "a=b", domain: "example.com", path: "/", secure: true });
    expect(session).toMatchObject({ name: "session", domain: ".example.com" });
  });

  it("drops pasted Set-Cookie attributes and malformed pairs", () => {
    const raw = "sid=1; Path=/; Domain=.example.com; Expires=Wed, 01 Jan 2031 00:00:00 GMT; Max-Age=60; SameSite=Lax; Secure; =x; empty=";
    expect(parseCookieString(raw, "example.com").map((cookie) => cookie.name)).toEqual(["sid"]);
  });
});
