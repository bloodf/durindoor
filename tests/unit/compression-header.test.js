// F-1b response-header propagation: withCompressionHeader must stamp
// X-DurinDoor-Compression onto the FINAL response object that chatCore's
// terminal handlers return (which are freshly built, not the upstream
// providerResponse). Covers JSON + SSE bodies and the no-op cases.
import { describe, it, expect } from "vitest";
import { withCompressionHeader } from "../../open-sse/handlers/chatCore.js";

const HEADER = "X-DurinDoor-Compression";

function jsonResult(body = { ok: true }) {
  return {
    success: true,
    response: new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

function sseResult() {
  return {
    success: true,
    response: new Response("data: {}\n\n", {
      status: 200,
      headers: { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" },
    }),
  };
}

describe("withCompressionHeader", () => {
  it("stamps header on a JSON success response, preserving status/body/existing headers", async () => {
    const out = withCompressionHeader(jsonResult(), "caveman|12.5%");
    expect(out.response.headers.get(HEADER)).toBe("caveman|12.5%");
    expect(out.response.headers.get("Content-Type")).toBe("application/json");
    expect(out.response.status).toBe(200);
    expect(await out.response.json()).toEqual({ ok: true });
  });

  it("stamps header on an SSE success response", () => {
    const out = withCompressionHeader(sseResult(), "session-dedup,caveman|8%");
    expect(out.response.headers.get(HEADER)).toBe("session-dedup,caveman|8%");
    expect(out.response.headers.get("Content-Type")).toBe("text/event-stream");
  });

  it("returns the SAME result object when headerValue is null (disabled / no-op)", () => {
    const r = jsonResult();
    expect(withCompressionHeader(r, null)).toBe(r);
    expect(r.response.headers.get(HEADER)).toBeNull();
  });

  it("does not decorate upstream error responses (success === false)", () => {
    const r = {
      success: false,
      response: new Response(JSON.stringify({ error: "x" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
    };
    const out = withCompressionHeader(r, "caveman|1%");
    expect(out).toBe(r);
    expect(out.response.headers.get(HEADER)).toBeNull();
  });

  it("tolerates a null/undefined result", () => {
    expect(withCompressionHeader(null, "caveman|1%")).toBeNull();
    expect(withCompressionHeader(undefined, "caveman|1%")).toBeUndefined();
  });
});
