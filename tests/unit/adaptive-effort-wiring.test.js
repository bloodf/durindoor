import { describe, expect, it } from "vitest";

import { wireAdaptiveEffort } from "../../open-sse/handlers/chatCore/adaptiveEffortWiring.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Port of OmniRoute #13448's chatCore wiring, adapted to the fork's chatCore.js
// call site (targetFormat, clientRawRequest, rawBody).
function ctx(overrides = {}) {
  return {
    rawBody: { messages: [{ role: "user", content: "hi" }] },
    clientRawRequest: { headers: {} },
    targetFormat: FORMATS.OPENAI,
    ...overrides,
  };
}

describe("wireAdaptiveEffort (chatCore adaptive-effort wiring, #13448 port)", () => {
  it("no-op when targetFormat is not OpenAI dispatch", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(body, ctx({ targetFormat: FORMATS.CLAUDE, clientRawRequest: { headers: { "x-durindoor-effort": "auto" } } }));
    expect(result).toBe(body);
  });

  it("no-op without the header opt-in", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(body, ctx());
    expect(result).toBe(body);
  });

  it("no-op when an explicit reasoning field is already present", () => {
    const body = { messages: [{ role: "user", content: "hi" }], reasoning_effort: "high" };
    const result = wireAdaptiveEffort(body, ctx({ clientRawRequest: { headers: { "x-durindoor-effort": "auto" } } }));
    expect(result).toBe(body);
  });

  it("resolves auto from the X-DurinDoor-Effort header (case-insensitive key)", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(
      body,
      ctx({ clientRawRequest: { headers: { "X-DurinDoor-Effort": "auto" } } }),
    );
    expect(result.reasoning_effort).toBe("low");
  });

  it("resolves auto from a Fetch API Headers instance", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(
      body,
      ctx({ clientRawRequest: { headers: new Headers({ "x-durindoor-effort": "auto" }) } }),
    );
    expect(result.reasoning_effort).toBe("low");
  });

  it("an unrecognized header value is ignored", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(
      body,
      ctx({ clientRawRequest: { headers: { "x-durindoor-effort": "max" } } }),
    );
    expect(result).toBe(body);
  });

  it("uses rawBody.messages (pre-translation) for turn-scoped signals", () => {
    const translatedBody = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(
      translatedBody,
      ctx({
        rawBody: { messages: [{ role: "user", content: "x".repeat(5000) }] },
        clientRawRequest: { headers: { "x-durindoor-effort": "auto" } },
      }),
    );
    expect(result.reasoning_effort).toBe("high");
  });

  it("ctx.headerEffort, when provided, wins over reading the header", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const result = wireAdaptiveEffort(
      body,
      ctx({ headerEffort: "auto", clientRawRequest: { headers: {} } }),
    );
    expect(result.reasoning_effort).toBe("low");
  });
});
