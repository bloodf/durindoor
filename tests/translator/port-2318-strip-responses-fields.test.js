// Regression for upstream decolua/9router#2318 — strip Responses-API-only fields.
// `client_metadata`, `background`, and `truncation` are valid on the OpenAI
// Responses API but rejected by third-party / chat-completions providers with
// HTTP 400. They must be removed before the translated request is forwarded.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("port #2318: strip Responses-API-only fields before forwarding", () => {
  it("drops client_metadata / background / truncation from Responses→Chat body", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", {
      input: [{ type: "message", role: "user", content: "hi" }],
      client_metadata: { user_id: "u1", trace: "t" },
      background: true,
      truncation: "auto",
    });
    expect(out, "client_metadata leaked").not.toHaveProperty("client_metadata");
    expect(out, "background leaked").not.toHaveProperty("background");
    expect(out, "truncation leaked").not.toHaveProperty("truncation");
  });

  it("keeps the translated messages intact after stripping", () => {
    const out = translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, "m", {
      input: [{ type: "message", role: "user", content: "hi" }],
      client_metadata: { user_id: "u1" },
    });
    expect(Array.isArray(out.messages), "messages lost during translation").toBe(true);
    expect(JSON.stringify(out)).toContain("hi");
  });

  it("negative control: OPENAI→OPENAI preserves client_metadata (strip is Responses-only)", () => {
    const out = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, "m", {
      messages: [{ role: "user", content: "hi" }],
      client_metadata: { user_id: "u1" },
    });
    // The Responses-only strip must not overreach into plain chat payloads.
    expect(out.client_metadata, "client_metadata wrongly stripped on chat path").toEqual({ user_id: "u1" });
  });
});
