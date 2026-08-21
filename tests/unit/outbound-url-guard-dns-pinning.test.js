import { Dispatcher } from "undici";
import { afterEach, describe, expect, it, vi } from "vitest";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ lookup: (...args) => dnsLookup(...args) }));

import {
  assertGuardedProbeDispatcherAddressAllowed,
  assertOutboundUrlAllowed,
  createGuardedProbeDispatcher,
  createOutboundUrlConnector,
  createOutboundUrlLookup,
  GUARDED_PROBE_MAX_ORIGINS,
  guardedProbeFetch,
  isGuardedProbeDispatcher,
  OutboundUrlGuardError,
} from "../../open-sse/utils/outboundUrlGuard.js";

afterEach(() => {
  dnsLookup.mockReset();
});

describe("outbound URL guard DNS pinning (#3313)", () => {
  it("refuses a hostname whose dispatcher lookup resolves to cloud metadata", async () => {
    dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]));

    let error;
    try {
      await guardedProbeFetch("http://rebind.example.test/latest/meta-data", {}, "block-metadata");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(OutboundUrlGuardError);
    expect(error).toMatchObject({
      code: "OUTBOUND_URL_GUARD_BLOCKED",
      hostname: "169.254.169.254",
    });
    expect(dnsLookup).toHaveBeenCalledWith(
      "rebind.example.test",
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function),
    );
  });

  it.each([
    "http://[::]/v1",
    "http://[::7f00:1]/v1",
    "http://[::ffff:7f00:1]/v1",
    "http://[fec0::1]/v1",
    "http://[ff02::1]/v1",
    "http://[2001:db8::1]/v1",
  ])("refuses non-public IPv6 literal %s under public-only", (url) => {
    expect(() => assertOutboundUrlAllowed(url, "public-only")).toThrow(OutboundUrlGuardError);
  });

  it("preserves compatible LAN literal support under block-metadata", () => {
    expect(() => assertOutboundUrlAllowed("http://[::7f00:1]/v1", "block-metadata")).not.toThrow();
  });

  it.each(["::", "::7f00:1", "::ffff:7f00:1"])(
    "refuses public-only DNS answer %s",
    async (address) => {
      dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, [
        { address, family: 6 },
      ]));
      const lookup = createOutboundUrlLookup("public-only", dnsLookup);

      await expect(new Promise((resolve, reject) => {
        lookup("rebind.example.test", { all: true }, (error, records) => {
          if (error) reject(error);
          else resolve(records);
        });
      })).rejects.toBeInstanceOf(OutboundUrlGuardError);
    },
  );

  it("keeps IPv4-compatible LAN answers available under block-metadata", async () => {
    const answers = [{ address: "::7f00:1", family: 6 }];
    dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, answers));
    const lookup = createOutboundUrlLookup("block-metadata", dnsLookup);

    await expect(new Promise((resolve, reject) => {
      lookup("lan-provider.example.test", { all: true }, (error, records) => {
        if (error) reject(error);
        else resolve(records);
      });
    })).resolves.toEqual(answers);
  });

  it.each(["block-metadata", "public-only"])(
    "refuses IPv4-mapped metadata DNS under %s",
    async (guard) => {
      dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, [
        { address: "::ffff:a9fe:a9fe", family: 6 },
      ]));
      const lookup = createOutboundUrlLookup(guard, dnsLookup);

      await expect(new Promise((resolve, reject) => {
        lookup("metadata-rebind.example.test", { all: true }, (error, records) => {
          if (error) reject(error);
          else resolve(records);
        });
      })).rejects.toBeInstanceOf(OutboundUrlGuardError);
    },
  );

  it("refuses a guarded probe instead of replacing its dispatcher with a configured proxy", async () => {
    const savedFetch = globalThis.fetch;
    const savedHttpsProxy = process.env.HTTPS_PROXY;
    const savedNoProxy = process.env.NO_PROXY;
    const savedNoProxyLower = process.env.no_proxy;
    const originalFetch = vi.fn();
    dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, [
      { address: "169.254.169.254", family: 4 },
    ]));

    try {
      process.env.HTTPS_PROXY = "http://proxy.example.test:8080";
      delete process.env.NO_PROXY;
      delete process.env.no_proxy;
      const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
      const restoreOriginalFetch = __setOriginalFetchForTesting(originalFetch);
      try {
        let error;
        try {
          await guardedProbeFetch(
            "https://rebind.example.test/latest/meta-data",
            {},
            "block-metadata",
          );
        } catch (caught) {
          error = caught;
        }
        expect(error).toBeInstanceOf(OutboundUrlGuardError);
        expect(error).toMatchObject({
          code: "OUTBOUND_URL_GUARD_BLOCKED",
          hostname: "rebind.example.test",
        });
      } finally {
        restoreOriginalFetch();
      }
      expect(originalFetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = savedFetch;
      if (savedHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
      else process.env.HTTPS_PROXY = savedHttpsProxy;
      if (savedNoProxy === undefined) delete process.env.NO_PROXY;
      else process.env.NO_PROXY = savedNoProxy;
      if (savedNoProxyLower === undefined) delete process.env.no_proxy;
      else process.env.no_proxy = savedNoProxyLower;
    }
  });

  it("allows a hostname resolving to ordinary LAN under block-metadata", async () => {
    const answers = [{ address: "192.168.1.20", family: 4 }];
    dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, answers));
    const lookup = createOutboundUrlLookup("block-metadata", dnsLookup);

    await expect(new Promise((resolve, reject) => {
      lookup("lan-provider.example.test", { all: true }, (error, records) => {
        if (error) reject(error);
        else resolve(records);
      });
    })).resolves.toEqual(answers);
  });

  it("refuses a blocked redirect IP literal at the connector boundary", async () => {
    const connector = createOutboundUrlConnector("block-metadata", dnsLookup);
    const error = await new Promise((resolve) => {
      connector({ hostname: "::ffff:a9fe:a9fe", protocol: "http:", port: "80" }, resolve);
    });

    expect(error).toBeInstanceOf(OutboundUrlGuardError);
    expect(error).toMatchObject({ code: "OUTBOUND_URL_GUARD_BLOCKED" });
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it("keeps dispatcher identity private and isolates cached guard modes", async () => {
    const seen = [];
    const fetcher = vi.fn(async (_url, init) => {
      seen.push(init.dispatcher);
      return { ok: true, status: 200 };
    });
    const forged = { [Symbol.for("durindoor.outboundUrlGuard.dispatcher")]: true };

    await guardedProbeFetch("https://one.example.test/models", { dispatcher: forged }, "block-metadata", fetcher);
    await guardedProbeFetch("https://two.example.test/models", {}, "block-metadata", fetcher);
    await guardedProbeFetch("https://one.example.test/models", {}, "public-only", fetcher);

    expect(isGuardedProbeDispatcher(forged)).toBe(false);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe(seen[2]);
    expect(() => assertGuardedProbeDispatcherAddressAllowed(forged, "127.0.0.1")).toThrow(TypeError);
  });

  it("bounds the guarded Agent origin pool", async () => {
    class HeldDispatcher extends Dispatcher {
      dispatch() { return true; }
      close() { return Promise.resolve(); }
      destroy() { return Promise.resolve(); }
    }
    const dispatcher = createGuardedProbeDispatcher("public-only", dnsLookup, {
      factory: () => new HeldDispatcher(),
    });
    const errors = [];
    const handler = {
      onConnect() {},
      onError(error) { errors.push(error); },
      onHeaders() {},
      onData() {},
      onComplete() {},
    };

    for (let index = 0; index < GUARDED_PROBE_MAX_ORIGINS; index += 1) {
      expect(dispatcher.dispatch({
        origin: `https://provider-${index}.example.test`,
        path: "/models",
        method: "GET",
      }, handler)).toBe(true);
    }
    expect(dispatcher.dispatch({
      origin: "https://one-origin-too-many.example.test",
      path: "/models",
      method: "GET",
    }, handler)).toBe(false);
    expect(errors.at(-1)?.message).toMatch(/maximum .* origins/i);
    await dispatcher.destroy();
  });

  it("forces redirect manual and its DNS-pinned dispatcher on every probe", async () => {
    const fetcher = vi.fn(async () => ({ ok: true, status: 200 }));

    await guardedProbeFetch("https://one.example.test/models", { redirect: "follow" }, "block-metadata", fetcher);
    await guardedProbeFetch("https://two.example.test/models", {}, "block-metadata", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init).toMatchObject({ redirect: "manual", dispatcher: expect.any(Object) });
    }
  });

  it("validates every Google-DNS MITM bypass answer before connecting", async () => {
    const {
      __setBypassTransportForTesting,
      __setRealIpResolverForTesting,
      proxyAwareFetch,
    } = await import("../../open-sse/utils/proxyFetch.js");
    const connect = vi.fn();
    const restoreTransport = __setBypassTransportForTesting({
      https: { request: vi.fn() },
      tls: { connect },
    });
    const restoreResolver = __setRealIpResolverForTesting(async () => [
      "93.184.216.34",
      "169.254.169.254",
    ]);

    try {
      await expect(guardedProbeFetch(
        "https://cloudcode-pa.googleapis.com/v1internal:test",
        {},
        "block-metadata",
        (url, init) => proxyAwareFetch(url, init, { disableEnvProxy: true }),
      )).rejects.toBeInstanceOf(OutboundUrlGuardError);
      expect(connect).not.toHaveBeenCalled();
    } finally {
      restoreResolver();
      restoreTransport();
    }
  });
});
