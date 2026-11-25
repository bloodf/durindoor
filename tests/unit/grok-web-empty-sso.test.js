import { afterEach, describe, expect, it, vi } from "vitest";
import { buildGrokCookieHeader, GrokWebExecutor } from "../../open-sse/executors/grok-web.js";

const executor = new GrokWebExecutor();

const event = (response) => JSON.stringify({ result: { response } }) + "\n";

const request = (apiKey, stream = false) => executor.execute({
  model: "grok-4",
  body: { messages: [{ role: "user", content: "hello" }] },
  stream,
  credentials: { apiKey },
});

afterEach(() => vi.unstubAllGlobals());

describe("Grok Web cookie header", () => {
  it("rejects an explicitly empty named sso instead of sending sso=sso=", () => {
    expect(buildGrokCookieHeader("sso=")).toBe("");
    expect(buildGrokCookieHeader("sso= ")).toBe("");
    expect(buildGrokCookieHeader("sso=;")).toBe("");
    expect(buildGrokCookieHeader("sso=\t")).toBe("");
  });

  it("rejects a header whose sso entry is empty", () => {
    expect(buildGrokCookieHeader("x-anonuserid=u1; sso=; cf_clearance=c")).toBe("");
    expect(buildGrokCookieHeader("x-anonuserid=u1; sso=   ; cf_clearance=c")).toBe("");
    expect(buildGrokCookieHeader("Cookie: sso=")).toBe("");
  });

  it("rejects a missing sso", () => {
    expect(buildGrokCookieHeader("")).toBe("");
    expect(buildGrokCookieHeader("   ")).toBe("");
    expect(buildGrokCookieHeader(undefined)).toBe("");
    expect(buildGrokCookieHeader("x-anonuserid=u1; cf_clearance=c")).toBe("");
  });

  it("accepts a bare value and a bare padded value", () => {
    expect(buildGrokCookieHeader("tok")).toBe("sso=tok");
    expect(buildGrokCookieHeader("tok==")).toBe("sso=tok==");
    expect(buildGrokCookieHeader("sso=tok")).toBe("sso=tok");
    expect(buildGrokCookieHeader("sso=tok==")).toBe("sso=tok==");
  });

  it("accepts a full signed cookie header and forwards it as pasted", () => {
    expect(buildGrokCookieHeader("Cookie: x-anonuserid=u1; sso=tok; sso-rw=tok; cf_clearance=c"))
      .toBe("x-anonuserid=u1; sso=tok; sso-rw=tok; cf_clearance=c");
  });
});

describe("Grok Web executor with an unusable session cookie", () => {
  it("fails locally with 401 and no outbound request for an empty sso", async () => {
    const fetch = vi.fn(async () => new Response(event({ modelResponse: { message: "hello back" } })));
    vi.stubGlobal("fetch", fetch);

    const { response } = await request("sso=");

    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toMatch(/no sso cookie/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails locally with 401 and no outbound request for a missing credential", async () => {
    const fetch = vi.fn(async () => new Response(event({ modelResponse: { message: "hello back" } })));
    vi.stubGlobal("fetch", fetch);

    const { response } = await request("");

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the built cookie for a valid bare value", async () => {
    const fetch = vi.fn(async () => new Response(event({ modelResponse: { message: "hello back" } })));
    vi.stubGlobal("fetch", fetch);

    const { response } = await request("tok");

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe("sso=tok");
  });

  it("sends a full signed header as pasted", async () => {
    const fetch = vi.fn(async () => new Response(event({ modelResponse: { message: "hello back" } })));
    vi.stubGlobal("fetch", fetch);

    const { response } = await request("Cookie: x-anonuserid=u1; sso=tok; cf_clearance=c");

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Cookie).toBe("x-anonuserid=u1; sso=tok; cf_clearance=c");
  });
});
