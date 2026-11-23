import { describe, expect, it } from "vitest";
import { authErrorResponse, createErrorResult } from "../../open-sse/utils/error.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("client error envelopes", () => {
  it.each([400, 401, 429, 502])("renders a %s error for each client after sanitizing", async (status) => {
    const upstream = { error: { type: "provider_error", code: "failure", message: "failed api_key=secret" } };
    const result = (format) => createErrorResult(status, "failed", undefined, upstream, null, null, status, format);
    const claude = await result(FORMATS.CLAUDE).response.json();
    const openai = await result(FORMATS.OPENAI).response.json();
    expect(claude).toEqual({ type: "error", error: { type: status === 401 ? "authentication_error" : "provider_error", message: "failed api_key=[redacted]" } });
    expect(openai).toEqual({ error: { type: "provider_error", code: "failure", message: "failed api_key=[redacted]" } });
    expect((await result(FORMATS.OPENAI_RESPONSES).response.json())).toEqual(openai);
  });
  it("uses the client format for authentication failures", async () => {
    expect(await authErrorResponse("/v1/messages", "invalid").json()).toEqual({ type: "error", error: { type: "authentication_error", message: "invalid" } });
    expect(await authErrorResponse("/v1/chat/completions", "invalid").json()).toHaveProperty("error.code");
  });
});
