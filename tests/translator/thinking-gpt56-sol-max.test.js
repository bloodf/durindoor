// Port of decolua/9router#2500 — surface "max" as a selectable level for
// gpt-5.6-sol in the UI. On the OpenAI wire the effort still clamps to
// "xhigh" (OpenAI's enum has no "max"); this test drives the REAL translator
// pipeline so the request-only `(max)` suffix is proven to be parsed and the
// outgoing model id cleaned.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const base = (model) => ({
  model,
  messages: [{ role: "user", content: "hi" }],
});

describe("gpt-5.6-sol (max) thinking suffix → OpenAI wire", () => {
  it("parses the (max) suffix, clamps effort to xhigh, strips suffix from model", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.6-sol(max)",
      base("gpt-5.6-sol(max)"),
      false,
      null,
      "openai",
    );
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.model).toBe("gpt-5.6-sol");
  });

  it("ordinary OpenAI model keeps the same clamp + strip behavior", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5(max)",
      base("gpt-5(max)"),
      false,
      null,
      "openai",
    );
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.model).toBe("gpt-5");
  });

  it("xhigh passes through unchanged for gpt-5.6-sol", () => {
    const out = translateRequest(
      FORMATS.OPENAI,
      FORMATS.OPENAI,
      "gpt-5.6-sol(xhigh)",
      base("gpt-5.6-sol(xhigh)"),
      false,
      null,
      "openai",
    );
    expect(out.reasoning_effort).toBe("xhigh");
    expect(out.model).toBe("gpt-5.6-sol");
  });
});
