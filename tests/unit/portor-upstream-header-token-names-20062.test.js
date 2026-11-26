import { describe, expect, it } from "vitest";
import { isValidHttpHeaderName, mergeUpstreamExtraHeaders } from "../../open-sse/executors/websession-utils.js";
import { WindsurfExecutor } from "../../open-sse/executors/windsurf.js";

const BAD = ["admin@example.com", "Bad Name", "X-Ünï", "a:b", "", "x\r\ny"];

describe("OmniRoute #20062 - reject non-token upstream header names", () => {
  it("accepts every token character and rejects everything else", () => {
    for (const name of ["X-Good_1.2", "!#$%&'*+-.^_`|~"]) expect(isValidHttpHeaderName(name)).toBe(true);
    for (const name of BAD) expect(isValidHttpHeaderName(name), JSON.stringify(name)).toBe(false);
  });

  it("merges only headers that fetch Headers accepts", () => {
    const extra = { ...Object.fromEntries(BAD.map((name) => [name, "secret"])), "X-Good": "ok" };
    const merged = mergeUpstreamExtraHeaders({ "Content-Type": "application/json" }, extra);
    expect(merged).toEqual({ "Content-Type": "application/json", "X-Good": "ok" });
    expect(() => new Headers(merged)).not.toThrow();
  });

  it("keeps a bad name out of the Windsurf dispatch while a valid one reaches it", async () => {
    const executor = new WindsurfExecutor();
    let sent;
    await executor.runChat(
      { model: "swe-1", body: { messages: [{ role: "user", content: "hi" }] }, upstreamExtraHeaders: { "admin@example.com": "secret", "X-Good": "ok" } },
      { sendRequest: async (_url, init) => { sent = init.headers; return new Response("nope", { status: 500 }); } },
      (response) => response,
    );
    expect(sent["X-Good"]).toBe("ok");
    expect(sent).not.toHaveProperty("admin@example.com");
  });
});
