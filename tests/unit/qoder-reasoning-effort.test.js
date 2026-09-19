/**
 * Qoder forwards reasoning_effort to upstream models (port of decolua/9router#4154).
 *
 * Qoder's private chat wire only exposes a generic `parameters.reasoning_effort`
 * string regardless of the underlying model family, so the provider-wide
 * thinkingFormat is "openai" and PATTERN_THINKING widens the picker to include
 * "max" instead of clamping it to "xhigh".
 */
import { describe, it, expect } from "vitest";

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import {
  applyThinking,
  stripThinkingSuffix,
} from "../../open-sse/translator/concerns/thinkingUnified.js";
import { __test__ as qoderExecutorInternals } from "../../open-sse/executors/qoder.js";
import "../translator/registerAll.js";

const { buildQoderParameters } = qoderExecutorInternals;

describe("Qoder reasoning effort passthrough", () => {
  it("uses OpenAI-style reasoning_effort normalization for the private Qoder payload", () => {
    expect(PROVIDERS.qoder.thinkingFormat).toBe("openai");
  });

  it("advertises xhigh and max for every Qoder model family (single generic wire)", () => {
    expect(getThinkingLevels("qoder", "qfmodel")).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(getThinkingLevels("qoder", "kmodel")).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });

  it("turns the qfmodel(xhigh) suffix into reasoning_effort=xhigh", () => {
    const body = {};
    applyThinking("openai", "qfmodel(xhigh)", body, "qoder");
    expect(body.reasoning_effort).toBe("xhigh");
    expect(stripThinkingSuffix("qfmodel(xhigh)")).toBe("qfmodel");
  });

  it("preserves max instead of clamping it to xhigh", () => {
    const body = {};
    applyThinking("openai", "qfmodel(max)", body, "qoder");
    expect(body.reasoning_effort).toBe("max");
  });

  it("preserves an explicit client reasoning_effort", () => {
    const body = { reasoning_effort: "xhigh" };
    applyThinking("openai", "qfmodel", body, "qoder");
    expect(body.reasoning_effort).toBe("xhigh");
  });

  it("moves explicit effort into Qoder parameters, lowercased", () => {
    expect(buildQoderParameters({ reasoning_effort: "XHIGH" }, 65_536)).toEqual({
      max_tokens: 65_536,
      reasoning_effort: "xhigh",
    });
  });

  it("keeps the server default when the client does not request an effort", () => {
    expect(buildQoderParameters({}, 65_536)).toEqual({ max_tokens: 65_536 });
    expect(buildQoderParameters({ reasoning_effort: "auto" }, 65_536)).toEqual({ max_tokens: 65_536 });
  });
});
