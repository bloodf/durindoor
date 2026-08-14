// Adapt OmniRoute#10256 executor-result contract guard to DurinDoor.
//
// Upstream `normalizeExecutorResult` returns only five canonical keys and would
// silently drop DurinDoor fields (`attemptStartedAt`, `terminalProvenance`)
// that chatCore reads at lines 964-969 and 1009. We adapt the guard to
// preserve every key on the input and validate the minimal shape required by
// the consumer path.
import { describe, it, expect } from "vitest";

const load = () => import("../../open-sse/handlers/chatCore/executorResultGuard.js");

const buildResponse = () => new Response("ok", { status: 200 });

const canonical = (extra = {}) => ({
  response: buildResponse(),
  url: "https://provider.example/v1/chat",
  headers: { "content-type": "application/json" },
  transformedBody: { model: "x", stream: false },
  attemptStartedAt: 1_700_000_000_000,
  terminalProvenance: "upstream",
  ...extra,
});

describe("validateExecutorResult", () => {
  it("normalizes a complete result while preserving DurinDoor metadata", async () => {
    const { validateExecutorResult } = await load();
    const input = canonical({ custom: "kept", trace: { id: 7 } });
    const out = validateExecutorResult(input);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
    expect(out.attemptStartedAt).toBe(1_700_000_000_000);
    expect(out.terminalProvenance).toBe("upstream");
    expect(out.custom).toBe("kept");
    expect(out.trace).toEqual({ id: 7 });
  });

  it("wraps a bare Response with canonical executor-result fields", async () => {
    const { validateExecutorResult } = await load();
    const response = buildResponse();
    expect(validateExecutorResult(response)).toEqual({
      response,
      url: "",
      headers: {},
      transformedBody: null,
    });
  });

  it("throws TypeError with the expected message when response is missing", async () => {
    const { validateExecutorResult } = await load();
    const input = canonical();
    delete input.response;
    expect(() => validateExecutorResult(input)).toThrowError(TypeError);
    expect(() => validateExecutorResult(input)).toThrowError(
      "Executor result must contain a Response",
    );
  });

  it("throws TypeError when response is not a Response-like object", async () => {
    const { validateExecutorResult } = await load();
    const input = canonical({ response: { status: 200 } });
    expect(() => validateExecutorResult(input)).toThrowError(TypeError);
    expect(() => validateExecutorResult(input)).toThrowError(
      "Executor result must contain a Response",
    );
  });

  it("throws TypeError when the result is null/undefined", async () => {
    const { validateExecutorResult } = await load();
    expect(() => validateExecutorResult(null)).toThrowError(TypeError);
    expect(() => validateExecutorResult(undefined)).toThrowError(TypeError);
  });

  it("accepts a complete response-like object from another realm", async () => {
    const { validateExecutorResult } = await load();
    const responseLike = {
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "text/plain" }),
      body: null,
      text: async () => "ok",
      json: async () => ({ message: "ok" }),
    };
    const out = validateExecutorResult(canonical({ response: responseLike }));
    expect(out.response).toBe(responseLike);
  });

  it("rejects partial response-like bags chatCore cannot consume", async () => {
    const { validateExecutorResult } = await load();
    const partial = { status: 200, headers: new Headers(), body: null };
    expect(() => validateExecutorResult(canonical({ response: partial }))).toThrowError(
      "Executor result must contain a Response",
    );
  });
});
