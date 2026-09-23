import { describe, expect, it } from "vitest";
import { buildNextAuthSessionCookie, mergeRefreshedCookie } from "../../src/lib/providers/webCookieAuth.js";
import { probeRegistryProvider, validateChatgptWebSession } from "../../src/app/api/providers/providerProbe.js";

// chatgpt.com splits a NextAuth session cookie over ~4KB into
// __Secure-next-auth.session-token.0, .1, ... Each chunk must go back under its
// own name, in index order, never concatenated into one cookie.
const NAME = "__Secure-next-auth.session-token";

describe("buildNextAuthSessionCookie", () => {
  it("wraps a bare token value as the unchunked cookie", () => {
    expect(buildNextAuthSessionCookie("  eyJhbGc.abc.def  ")).toBe(`${NAME}=eyJhbGc.abc.def`);
  });

  it("keeps a bare value with base64 padding verbatim (stored connections)", () => {
    expect(buildNextAuthSessionCookie("abc==")).toBe(`${NAME}=abc==`);
  });

  it("accepts name=value for the unchunked cookie", () => {
    expect(buildNextAuthSessionCookie(`${NAME}=tok123`)).toBe(`${NAME}=tok123`);
  });

  it("accepts a full Cookie header and keeps other cookies after the session", () => {
    const header = `Cookie: _ga=1; ${NAME}=tok123; cf_clearance=cf`;
    expect(buildNextAuthSessionCookie(header)).toBe(`${NAME}=tok123; _ga=1; cf_clearance=cf`);
  });

  it("sends .0/.1 chunks as separate cookies in index order", () => {
    const expected = `${NAME}.0=AAA; ${NAME}.1=BBB`;
    expect(buildNextAuthSessionCookie(`${NAME}.0=AAA; ${NAME}.1=BBB`)).toBe(expected);
    expect(buildNextAuthSessionCookie(`${NAME}.1=BBB; ${NAME}.0=AAA`)).toBe(expected);
  });

  it("orders three chunks numerically and drops a stale unchunked cookie", () => {
    const header = `__cf_bm=x; ${NAME}.2=CCC; ${NAME}=stale; ${NAME}.0=AAA; ${NAME}.1=BBB`;
    expect(buildNextAuthSessionCookie(header)).toBe(`${NAME}.0=AAA; ${NAME}.1=BBB; ${NAME}.2=CCC; __cf_bm=x`);
  });

  it("orders chunk 10 after chunk 2", () => {
    expect(buildNextAuthSessionCookie(`${NAME}.10=K; ${NAME}.2=C`)).toBe(`${NAME}.2=C; ${NAME}.10=K`);
  });

  it("returns empty for junk and empty input", () => {
    expect(buildNextAuthSessionCookie("")).toBe("");
    expect(buildNextAuthSessionCookie(null)).toBe("");
    expect(buildNextAuthSessionCookie("_ga=1; theme=dark")).toBe("");
    expect(buildNextAuthSessionCookie("not a cookie")).toBe("");
  });
});

describe("validateChatgptWebSession", () => {
  const capture = (response) => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url, options });
      return response;
    };
    return { calls, fetcher };
  };
  const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it("sends chunks as separate cookies to /api/auth/session and accepts an accessToken", async () => {
    const { calls, fetcher } = capture(jsonResponse(200, { accessToken: "eyJ.at" }));
    const result = await validateChatgptWebSession({ apiKey: `${NAME}.1=BBB; ${NAME}.0=AAA`, fetcher });

    expect(result).toMatchObject({ valid: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://chatgpt.com/api/auth/session");
    expect(calls[0].options.method).toBe("GET");
    expect(calls[0].options.headers.Cookie).toBe(`${NAME}.0=AAA; ${NAME}.1=BBB`);
  });

  it("rejects an expired or incomplete session ({} body)", async () => {
    const { fetcher } = capture(jsonResponse(200, {}));
    const result = await validateChatgptWebSession({ apiKey: "tok", fetcher });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/chunk/);
  });

  it("rejects a non-2xx answer with the status", async () => {
    const { fetcher } = capture(jsonResponse(403, null));
    const result = await validateChatgptWebSession({ apiKey: "tok", fetcher });
    expect(result).toMatchObject({ valid: false, status: 403 });
  });

  it("does not fetch when no session cookie is present", async () => {
    const { calls, fetcher } = capture(jsonResponse(200, { accessToken: "x" }));
    const result = await validateChatgptWebSession({ apiKey: "_ga=1; theme=dark", fetcher });
    expect(result.valid).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("is wired as the chatgpt-web registry validator", async () => {
    const { calls, fetcher } = capture(jsonResponse(200, { accessToken: "x" }));
    const result = await probeRegistryProvider("chatgpt-web", `${NAME}=tok`, fetcher);
    expect(result).toMatchObject({ valid: true });
    expect(calls[0].url).toBe("https://chatgpt.com/api/auth/session");
  });
});

describe("mergeRefreshedCookie", () => {
  it("returns null without a rotated session cookie", () => {
    expect(mergeRefreshedCookie(`${NAME}=a`, null)).toBeNull();
    expect(mergeRefreshedCookie(`${NAME}=a`, "other=1; Path=/")).toBeNull();
  });

  it("replaces rotated chunks, keeps cf_clearance, drops stale chunks", () => {
    const merged = mergeRefreshedCookie(
      `${NAME}.0=OLD0; ${NAME}.1=OLD1; cf_clearance=CF`,
      `${NAME}.0=NEW0; Path=/; HttpOnly, ${NAME}.1=NEW1; Path=/; HttpOnly`
    );
    expect(merged).toBe(`cf_clearance=CF; ${NAME}.0=NEW0; ${NAME}.1=NEW1`);
  });

  it("handles unchunked to chunked rotation", () => {
    const merged = mergeRefreshedCookie(`Cookie: ${NAME}=OLD; _ga=1`, `${NAME}.0=A; ${NAME}.1=B`);
    expect(merged).toBe(`_ga=1; ${NAME}.0=A; ${NAME}.1=B`);
  });

  it("turns a stored bare value into the rotated pairs", () => {
    expect(mergeRefreshedCookie("bare-token", `${NAME}=NEW; Secure`)).toBe(`${NAME}=NEW`);
  });

  it("returns null when the rotated value is unchanged", () => {
    expect(mergeRefreshedCookie(`${NAME}=SAME; cf_clearance=CF`, `${NAME}=SAME; Path=/`)).toBeNull();
  });
});
