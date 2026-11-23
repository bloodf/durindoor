import { describe, expect, it } from "vitest";
import { CursorExecutor } from "../../open-sse/executors/cursor.js";

function errorFrame(code, message) {
  const payload = Buffer.from(JSON.stringify({ error: { code, message } }));
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

describe("Cursor Connect error classification", () => {
  it.each([
    ["resource_exhausted", "request too large", 400, "invalid_request_error"],
    ["resource_exhausted", "quota exceeded", 429, "rate_limit_error"],
    ["not_found", "AI Model Not Found (reset after 109h)", 429, "rate_limit_error"],
    ["not_found", "AI Model Not Found", 404, "invalid_request_error"],
    ["resource_exhausted", "model-x is not included in your weekly usage", 404, "invalid_request_error"],
    ["unauthenticated", "expired token", 401, "authentication_error"],
  ])("classifies %s: %s", async (code, message, status, type) => {
    const response = new CursorExecutor().transformProtobufToJSON(errorFrame(code, message), "model", {});
    expect(response.status).toBe(status);
    expect((await response.json()).error.type).toBe(type);
  });
});
