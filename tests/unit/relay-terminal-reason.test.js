// Guards the exported terminal-reason classifier used by chatCore's quota
// settlement paths (OmniRoute#7093 port): a relay-bound timeout surfaces
// downstream as an AbortError whose message (or cause message) says
// "timeout", and MUST settle as reason "timeout", not "abort".
import { describe, it, expect } from "vitest";
import { classifyQuotaTerminalReason } from "../../open-sse/utils/quotaTerminalReason.js";

describe("classifyQuotaTerminalReason (relay timeout)", () => {
  it("classifies AbortError with timeout message as timeout", () => {
    expect(classifyQuotaTerminalReason(new DOMException("fetch connect timeout", "AbortError"))).toBe("timeout");
  });

  it("classifies AbortError carrying a timeout cause as timeout", () => {
    const cause = new Error("fetch connect timeout");
    const error = new DOMException("fetch connect timeout", "AbortError");
    error.cause = cause;
    expect(classifyQuotaTerminalReason(error)).toBe("timeout");
  });

  it("classifies a plain client AbortError as abort", () => {
    expect(classifyQuotaTerminalReason(new DOMException("The operation was aborted", "AbortError"))).toBe("abort");
  });

  it("classifies TimeoutError by name as timeout", () => {
    expect(classifyQuotaTerminalReason(new DOMException("timed out", "TimeoutError"))).toBe("timeout");
  });

  it("classifies unrelated errors with the stream_error fallback", () => {
    expect(classifyQuotaTerminalReason(new Error("upstream reset"))).toBe("stream_error");
  });

  it("honors the transport_error fallback for the pre-response transport catch", () => {
    expect(classifyQuotaTerminalReason(new Error("socket hang up"), { fallback: "transport_error" }))
      .toBe("transport_error");
  });

  it("treats an externally-aborted providerSignal as abort even without an AbortError name", () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyQuotaTerminalReason(new Error("fetch failed"), { providerSignal: controller.signal }))
      .toBe("abort");
  });

  it("prefers timeout over an aborted providerSignal when the error says timeout", () => {
    const controller = new AbortController();
    controller.abort(new Error("fetch connect timeout"));
    expect(
      classifyQuotaTerminalReason(new DOMException("fetch connect timeout", "AbortError"), {
        providerSignal: controller.signal,
      })
    ).toBe("timeout");
  });
});
