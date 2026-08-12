// #2031 — forceStream (stream-only) providers must keep streaming even when the
// client asks for a non-streaming/JSON response. 9Router then accumulates the
// provider's stream and returns a normal JSON body to the client.
import { describe, it, expect } from "vitest";
import { resolveStreamFlag } from "../../open-sse/handlers/chatCore/streamFlag.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("resolveStreamFlag (#2031)", () => {
  it("keeps streaming for a forceStream provider even when client prefers JSON and sets stream:false", () => {
    // The bug: this returned false, sending stream:false to a stream-only
    // provider (e.g. CommandCode) → 400 Bad Request.
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: true,
        bodyStream: false,
        clientPrefersJson: true,
        clientPrefersSSE: false,
      })
    ).toBe(true);
  });

  it("non-forceStream provider: client prefers JSON + stream:false → non-streaming (unchanged)", () => {
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: false,
        bodyStream: false,
        clientPrefersJson: true,
        clientPrefersSSE: false,
      })
    ).toBe(false);
  });

  it("forceStream provider streams when no stream flag is given", () => {
    expect(resolveStreamFlag({ providerRequiresStreaming: true })).toBe(true);
  });

  it("ordinary provider does not stream when no stream flag is given", () => {
    expect(resolveStreamFlag({ providerRequiresStreaming: false })).toBe(false);
  });

  it("ordinary provider streams when stream:true is explicit", () => {
    expect(
      resolveStreamFlag({ providerRequiresStreaming: false, bodyStream: true })
    ).toBe(true);
  });

  it("forceNonStreaming (e.g. image-gen) still wins over forceStream", () => {
    expect(
      resolveStreamFlag({ providerRequiresStreaming: true, forceNonStreaming: true })
    ).toBe(false);
  });

  it("forceNonStreaming providers stay non-streaming even when the request asks for SSE", () => {
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: false,
        forceNonStreaming: true,
        bodyStream: true,
        clientPrefersSSE: true,
      })
    ).toBe(false);
  });

  it("AI21 quirk forceNonStreamingWithTools downgrades to non-streaming when tools are present", () => {
    expect(PROVIDERS["ai21"]?.quirks?.forceNonStreamingWithTools).toBe(true);
    const body = { model: "jamba-large-1.7", messages: [], tools: [{ type: "function" }] };
    const providerForceNonStreamingWithTools =
      PROVIDERS["ai21"]?.quirks?.forceNonStreamingWithTools === true &&
      Array.isArray(body.tools) &&
      body.tools.length > 0;
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: false,
        bodyStream: true,
        forceNonStreaming: providerForceNonStreamingWithTools,
        clientPrefersSSE: true,
      })
    ).toBe(false);
  });

  it("AI21 quirk does not downgrade streaming when no tools are present", () => {
    const body = { model: "jamba-large-1.7", messages: [] };
    const providerForceNonStreamingWithTools =
      PROVIDERS["ai21"]?.quirks?.forceNonStreamingWithTools === true &&
      Array.isArray(body.tools) &&
      body.tools.length > 0;
    expect(
      resolveStreamFlag({
        providerRequiresStreaming: false,
        bodyStream: true,
        forceNonStreaming: providerForceNonStreamingWithTools,
        clientPrefersSSE: true,
      })
    ).toBe(true);
  });
});
