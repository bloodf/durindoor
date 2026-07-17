import { describe, expect, it, vi } from "vitest";

describe("direct egress dispatcher", () => {
  it("enables Happy Eyeballs for direct fetches", async () => {
    vi.resetModules();
    const { getDirectDispatcherOptionsForTest } = await import(
      "../../open-sse/utils/proxyFetch.js"
    );
    const options = getDirectDispatcherOptionsForTest();

    expect(options.connect.autoSelectFamily).toBe(true);
    expect(options.connect.autoSelectFamilyAttemptTimeout).toBe(1000);
  });

  it("preserves a caller-provided dispatcher when no proxy is selected", async () => {
    vi.resetModules();
    const customDispatcher = { custom: true };
    const fetchMock = vi.fn(async () => new Response("ok"));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      await proxyAwareFetch("https://example.com/test", {
        dispatcher: customDispatcher,
      });
      const [, options] = fetchMock.mock.calls[0];
      expect(options.dispatcher).toBe(customDispatcher);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not recurse through a host wrapper installed after proxy patching", async () => {
    vi.resetModules();
    const savedFetch = globalThis.fetch;
    const nextPatchSymbol = Symbol.for("next-patch");
    const savedNextPatch = globalThis[nextPatchSymbol];
    const nativeFetch = vi.fn(async () => new Response("ok"));
    globalThis.fetch = nativeFetch;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const durindoorPatchedFetch = globalThis.fetch;
      const dedupedOrigin = vi.fn((...args) => durindoorPatchedFetch(...args));
      const lateHostWrapper = vi.fn((...args) => dedupedOrigin(...args));
      lateHostWrapper.__nextPatched = true;
      lateHostWrapper.__nextGetStaticStore = () => null;
      lateHostWrapper._nextOriginalFetch = dedupedOrigin;
      globalThis[nextPatchSymbol] = true;
      globalThis.fetch = lateHostWrapper;

      const response = await proxyAwareFetch("https://example.com/test", {
        dispatcher: { host: "provided" },
      });

      expect(await response.text()).toBe("ok");
      expect(nativeFetch).toHaveBeenCalledOnce();
      expect(lateHostWrapper).not.toHaveBeenCalled();
      expect(dedupedOrigin).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedNextPatch === undefined) delete globalThis[nextPatchSymbol];
      else globalThis[nextPatchSymbol] = savedNextPatch;
    }
  });

  it("preserves an unrelated late fetch that only spoofs part of Next's marker", async () => {
    vi.resetModules();
    const savedFetch = globalThis.fetch;
    const nativeFetch = vi.fn(async () => new Response("native"));
    globalThis.fetch = nativeFetch;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      const unrelatedFetch = vi.fn(async () => new Response("replacement"));
      unrelatedFetch.__nextPatched = true;
      unrelatedFetch._nextOriginalFetch = nativeFetch;
      globalThis.fetch = unrelatedFetch;

      const response = await proxyAwareFetch(
        "https://example.com/test",
        { dispatcher: { host: "provided" } },
        { disableEnvProxy: true },
      );

      expect(await response.text()).toBe("replacement");
      expect(unrelatedFetch).toHaveBeenCalledOnce();
      expect(nativeFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("falls back to the captured transport when global fetch disappears", async () => {
    vi.resetModules();
    const savedFetch = globalThis.fetch;
    const nativeFetch = vi.fn(async () => new Response("native"));
    globalThis.fetch = nativeFetch;
    try {
      const { proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js");
      globalThis.fetch = undefined;

      const response = await proxyAwareFetch(
        "https://example.com/test",
        { dispatcher: { host: "provided" } },
        { disableEnvProxy: true },
      );

      expect(await response.text()).toBe("native");
      expect(nativeFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("breaks a Next dedupe cycle across duplicate module instances", async () => {
    vi.resetModules();
    const savedFetch = globalThis.fetch;
    const nextPatchSymbol = Symbol.for("next-patch");
    const savedNextPatch = globalThis[nextPatchSymbol];
    const nativeFetch = vi.fn(async () => new Response("native"));
    globalThis.fetch = nativeFetch;
    try {
      const moduleA = await import("../../open-sse/utils/proxyFetch.js?instance=a");
      const dedupedOrigin = vi.fn((...args) => moduleA.default(...args));
      const nextWrapper = vi.fn((...args) => dedupedOrigin(...args));
      nextWrapper.__nextPatched = true;
      nextWrapper.__nextGetStaticStore = () => null;
      nextWrapper._nextOriginalFetch = dedupedOrigin;
      globalThis[nextPatchSymbol] = true;
      globalThis.fetch = nextWrapper;

      const moduleB = await import("../../open-sse/utils/proxyFetch.js?instance=b");
      const response = await moduleB.proxyAwareFetch(
        "https://example.com/test",
        { dispatcher: { host: "provided" } },
        { disableEnvProxy: true },
      );

      expect(await response.text()).toBe("native");
      expect(nativeFetch).toHaveBeenCalledOnce();
      expect(nextWrapper).toHaveBeenCalledOnce();
      expect(dedupedOrigin).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedNextPatch === undefined) delete globalThis[nextPatchSymbol];
      else globalThis[nextPatchSymbol] = savedNextPatch;
    }
  });
});
