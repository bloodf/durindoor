import { describe, expect, it } from "vitest";

import {
  buildErrorBody,
  createErrorResult,
  errorResponse,
  sanitizeErrorMessage,
  unavailableResponse,
  writeStreamError,
} from "../../open-sse/utils/error.js";

// OmniRoute #6886 (Rule 12): every API error response is routed through
// sanitizeErrorMessage at the shared root builders so stack traces, absolute
// source paths, and credentials never reach an HTTP client — while status
// codes, response shape, and safe actionable messages are preserved.
const LEAK =
  "SqliteError: disk I/O error while opening /home/omni/secret/config.ts:42\n" +
  "    at Database.prepare (C:\\Users\\secret\\app.ts:10:5)\n" +
  "    at listEntries (/opt/omniroute/src/lib/db/x.ts:88:12)";

describe("sanitizeErrorMessage", () => {
  it("strips the stack-trace tail and masks POSIX + Windows source paths", () => {
    const out = sanitizeErrorMessage(LEAK);
    expect(out).not.toContain("/home/omni/secret");
    expect(out).not.toContain("C:\\Users\\secret");
    expect(out).not.toContain("/opt/omniroute");
    expect(out).toContain("<path>");
    expect(out).toContain("SqliteError: disk I/O error while opening <path>");
  });

  it("masks a Windows source path on the first line", () => {
    const out = sanitizeErrorMessage("boom at C:\\Users\\secret\\app.ts:10:5 now");
    expect(out).not.toContain("C:\\Users\\secret");
    expect(out).toContain("boom at <path> now");
  });

  it("masks a parenthesized POSIX source path (stack-frame shape)", () => {
    const out = sanitizeErrorMessage("failed (/opt/omniroute/src/lib/db/x.ts:88:12) badly");
    expect(out).not.toContain("/opt/omniroute");
    expect(out).toContain("failed <path> badly");
  });

  it("keeps a safe URL diagnostic unchanged (no scheme-headed token masking)", () => {
    const msg = "fetch failed for https://cdn.example.com/lib.js";
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it("redacts credentials and keeps secrets out of the message", () => {
    // Separate calls per secret control: the Bearer rule consumes the rest of
    // the line by design, so a single combined string could pass vacuously.
    const userinfo = sanitizeErrorMessage("connect http://user:proxy-secret@proxy.local:8080 failed");
    expect(userinfo).not.toContain("proxy-secret");
    expect(userinfo).toContain("http://[redacted]@proxy.local:8080");

    const jsonField = sanitizeErrorMessage('denied: {"access_token":"tok-secret"}');
    expect(jsonField).not.toContain("tok-secret");
    expect(jsonField).toContain('[redacted]');

    const bearer = sanitizeErrorMessage("auth failed Bearer bearer-secret");
    expect(bearer).not.toContain("bearer-secret");
    expect(bearer).toContain("Bearer [redacted]");

    const queryParam = sanitizeErrorMessage("retry https://api.local/v1?api_key=key-secret");
    expect(queryParam).not.toContain("key-secret");
    expect(queryParam).toContain("api_key=[redacted]");
  });

  it("caps pathological input at 4096 chars before tokenization", () => {
    expect(sanitizeErrorMessage("x".repeat(5000))).toHaveLength(4096);
  });

  it("redacts a JSON credential whose closing quote was cut by the 4096 cap (P1)", () => {
    // Secret starts before the cap; its closing delimiter is beyond it, so
    // the closed-quote redactor cannot match — the truncated-tail rule must.
    const pad = "p".repeat(4000);
    const msg = `err ${pad} {"access_token":"SECRET-PREFIX-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"}`;
    const out = sanitizeErrorMessage(msg);
    expect(msg.length).toBeGreaterThan(4096);
    expect(out).not.toContain("SECRET-PREFIX");
    expect(out).toContain("[redacted]");
  });

  it("redacts URL userinfo whose @ was cut by the 4096 cap (P1)", () => {
    const pad = "p".repeat(4000);
    const msg = `connect ${pad} http://user:supersecretpassword-that-keeps-going-past-the-cap-boundary@proxy.local:8080 failed`;
    const out = sanitizeErrorMessage(msg);
    expect(msg.length).toBeGreaterThan(4096);
    expect(out).not.toContain("supersecret");
  });

  it("leaves a safe terminal URL unchanged even when truncated at 4096 (P1 regression)", () => {
    const pad = "q".repeat(4060);
    const msg = `${pad} failed https://api.example.com${"z".repeat(50)}`;
    const out = sanitizeErrorMessage(msg);
    expect(msg.length).toBeGreaterThan(4096);
    // No userinfo tail (no `user:secret` shape) → the host survives the cap.
    expect(out).toContain("https://api.example.com");
    expect(out).not.toContain("[redacted]@");
  });

  it("leaves a safe scheme+host at message end unchanged (no false userinfo redaction)", () => {
    const msg = "failed https://api.example.com";
    expect(sanitizeErrorMessage(msg)).toBe(msg);
  });

  it("leaves a short first-line URL untouched when excess length is in later stack lines", () => {
    // The 4096 cap falls in the stack tail, not the first line — delimiters
    // are intact, so no incomplete-tail rule may fire on `localhost:8080`.
    const firstLine = "GET http://localhost:8080/v1 failed";
    const stack = "\n    at x " + "s".repeat(5000);
    const out = sanitizeErrorMessage(firstLine + stack);
    expect((firstLine + stack).length).toBeGreaterThan(4096);
    expect(out).toBe(firstLine);
  });

  it("leaves a numeric port tail unchanged when the first line is capped", () => {
    // Construct so the 4096 cap ends EXACTLY after `:8080` — a purely numeric
    // tail is a port, not a password, and must not trigger userinfo redaction.
    const url = "http://localhost:8080";
    const prefix = "q".repeat(4096 - url.length - 1) + " ";
    const msg = `${prefix}${url}${"z".repeat(100)}`;
    expect(msg.slice(0, 4096).endsWith(":8080")).toBe(true);
    const out = sanitizeErrorMessage(msg);
    expect(out).toContain("http://localhost:8080");
    expect(out).not.toContain("[redacted]@");
  });

  it("masks a source path with a parenthesized line/column suffix (P2)", () => {
    const posix = sanitizeErrorMessage("failed at /opt/app/src/app.ts(10,5): boom");
    expect(posix).not.toContain("/opt/app/src");
    expect(posix).toContain("<path>");
    const win = sanitizeErrorMessage("failed at C:\\repo\\src\\app.ts(10,5): boom");
    expect(win).not.toContain("C:\\repo\\src");
    expect(win).toContain("<path>");
  });

  it("masks a source path embedded in a JSON body token (P2)", () => {
    const msg = '500 {"error":{"message":"failed at /opt/app/src/app.ts:1"}}';
    const out = sanitizeErrorMessage(msg);
    expect(out).not.toContain("/opt/app/src");
    expect(out).toContain("<path>");
  });

  it("passes a safe message through unchanged", () => {
    expect(sanitizeErrorMessage("Model not found")).toBe("Model not found");
    expect(sanitizeErrorMessage("Invalid JSON body")).toBe("Invalid JSON body");
  });
});

describe("root seam: buildErrorBody/errorResponse/writeStreamError", () => {
  it("buildErrorBody sanitizes the message and preserves status metadata", () => {
    const body = buildErrorBody(500, LEAK);
    expect(body.error.message).not.toContain("/home/omni/secret");
    expect(body.error.message).not.toContain("C:\\Users\\secret");
    expect(body.error.message).toContain("<path>");
    expect(body.error.type).toBe("server_error");
    expect(body.error.code).toBe("internal_server_error");
  });

  it("errorResponse emits a sanitized body with the original status code", async () => {
    const res = errorResponse(500, LEAK);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).not.toContain("/home/omni/secret");
    expect(body.error.message).toContain("<path>");
  });

  it("errorResponse routes a secret-bearing first line through the sanitizer", async () => {
    const res = errorResponse(500, 'upstream denied: {"refresh_token":"rt-secret"} Bearer b-secret');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).not.toContain("rt-secret");
    expect(body.error.message).not.toContain("b-secret");
    expect(body.error.message).toContain("[redacted]");
  });

  it("errorResponse keeps a safe message and a 4xx status unchanged", async () => {
    const res = errorResponse(404, "batch not found");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe("batch not found");
  });

  it("errorResponse falls back to the status default for an empty message", async () => {
    const res = errorResponse(500, "");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.message).not.toBe("");
  });

  it("writeStreamError writes a sanitized SSE error frame", async () => {
    let written = "";
    const writer = { write: async (chunk) => { written += new TextDecoder().decode(chunk); } };
    await writeStreamError(writer, 502, LEAK);
    expect(written.startsWith("data: ")).toBe(true);
    expect(written).not.toContain("/home/omni/secret");
    expect(written).not.toContain("C:\\Users\\secret");
    expect(written).toContain("<path>");
    expect(JSON.parse(written.slice("data: ".length).trim()).error.message).toContain(
      "SqliteError: disk I/O error while opening <path>"
    );
  });
});

describe("createErrorResult structured errorBody (bypasses buildErrorBody)", () => {
  it("sanitizes error.message on a clone; caller object never mutated; status preserved", async () => {
    const errorBody = {
      error: {
        message: "provider blew up at /home/omni/secret/config.ts:42\n    at x (/opt/a/b.js:1:1)",
        type: "provider_error",
        code: "PROVIDER blew",
      },
      upstream_details: { note: "kept verbatim" },
    };
    const result = createErrorResult(502, "fallback msg with /home/omni/secret/config.ts:1", null, errorBody);

    // Caller object untouched.
    expect(errorBody.error.message).toContain("/home/omni/secret");
    // Emitted response sanitized, shape + provider fields preserved.
    expect(result.response.status).toBe(502);
    const body = await result.response.json();
    expect(body.error.message).not.toContain("/home/omni/secret");
    expect(body.error.message).toContain("<path>");
    expect(body.error.type).toBe("provider_error");
    expect(body.error.code).toBe("PROVIDER blew");
    expect(body.upstream_details).toEqual({ note: "kept verbatim" });
  });
});

describe("unavailableResponse", () => {
  it("sanitizes the message and preserves status + Retry-After", async () => {
    const retryAt = new Date(Date.now() + 30_000).toISOString();
    const res = unavailableResponse(429, "quota hit opening /home/omni/secret/config.ts:3", retryAt, "reset after 30s");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body.error.message).not.toContain("/home/omni/secret");
    expect(body.error.message).toContain("<path>");
    expect(body.error.message).toContain("(reset after 30s)");
  });
});
