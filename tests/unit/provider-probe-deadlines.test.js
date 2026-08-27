import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  testProxyUrl: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: mocks.testProxyUrl }));

const originalFetch = globalThis.fetch;

function installFakeDeadline() {
  const signals = [];
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((timeoutMs) => {
    const controller = new AbortController();
    const signal = controller.signal;
    signals.push(signal);
    setTimeout(
      () => controller.abort(new DOMException(`Timed out after ${timeoutMs}ms`, "TimeoutError")),
      timeoutMs,
    );
    return signal;
  });
  return { signals, spy };
}

describe("provider probe deadlines", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
    mocks.testProxyUrl.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("aborts validation transport when its ten second deadline expires", async () => {
    vi.useFakeTimers();
    const { signals, spy } = installFakeDeadline();
    let receivedSignal;
    const transport = vi.fn((_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        receivedSignal.addEventListener("abort", () => reject(receivedSignal.reason), { once: true });
      });
    });

    try {
      const { fetchValidationProbe } = await import(
        "../../src/app/api/providers/validate/route.js"
      );
      const pending = fetchValidationProbe("https://api.example.com/probe", {}, transport);
      expect(spy).toHaveBeenCalledWith(10_000);
      const rejects = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });

      await vi.advanceTimersByTimeAsync(10_000);
      await rejects;
      expect(signals).toContain(receivedSignal);
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("preserves caller cancellation on validation probes", async () => {
    vi.useFakeTimers();
    const { spy } = installFakeDeadline();
    const caller = new AbortController();
    const callerReason = new Error("caller cancelled");
    let receivedSignal;
    const transport = vi.fn((_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        receivedSignal.addEventListener("abort", () => reject(receivedSignal.reason), { once: true });
      });
    });

    try {
      const { fetchValidationProbe } = await import(
        "../../src/app/api/providers/validate/route.js"
      );
      const pending = fetchValidationProbe("https://api.example.com/probe", { signal: caller.signal }, transport);
      const rejects = expect(pending).rejects.toBe(callerReason);

      expect(receivedSignal).not.toBe(caller.signal);
      caller.abort(callerReason);
      await rejects;
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("adds one 15 second deadline to proxy-aware connection fetches", async () => {
    vi.useFakeTimers();
    const { signals, spy } = installFakeDeadline();
    let receivedSignal;
    const transport = vi.fn(async (_url, options) => {
      receivedSignal = options.signal;
      return new Response("{}", { status: 200 });
    });
    const { __setProviderTestFetchForTesting, fetchWithConnectionProxy } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const restore = __setProviderTestFetchForTesting(transport);

    try {
      await fetchWithConnectionProxy("https://api.example.com/probe", { method: "GET" });
      expect(spy).toHaveBeenCalledWith(15_000);
      expect(signals).toContain(receivedSignal);
    } finally {
      restore();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("aborts proxy-aware connection fetches when the 15 second deadline expires", async () => {
    vi.useFakeTimers();
    const { spy } = installFakeDeadline();
    const transport = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const { __setProviderTestFetchForTesting, fetchWithConnectionProxy } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const restore = __setProviderTestFetchForTesting(transport);

    try {
      const pending = fetchWithConnectionProxy("https://api.example.com/probe");
      const rejects = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });

      await vi.advanceTimersByTimeAsync(15_000);
      await rejects;
    } finally {
      restore();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("merges a connection caller signal with the 15 second deadline", async () => {
    vi.useFakeTimers();
    const { spy } = installFakeDeadline();
    const caller = new AbortController();
    const callerReason = new Error("caller cancelled");
    let receivedSignal;
    const transport = vi.fn((_url, options) => {
      receivedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        receivedSignal.addEventListener("abort", () => reject(receivedSignal.reason), { once: true });
      });
    });
    const { __setProviderTestFetchForTesting, fetchWithConnectionProxy } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const restore = __setProviderTestFetchForTesting(transport);

    try {
      const pending = fetchWithConnectionProxy("https://api.example.com/probe", { signal: caller.signal });
      const rejects = expect(pending).rejects.toBe(callerReason);

      expect(receivedSignal).not.toBe(caller.signal);
      caller.abort(callerReason);
      await rejects;
    } finally {
      restore();
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("routes Ollama Cloud validation through proxy-aware bounded transport", async () => {
    const effectiveProxy = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      vercelRelayUrl: "https://relay.example",
    };
    mocks.resolveConnectionProxyConfig.mockResolvedValue(effectiveProxy);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-ollama",
      provider: "ollama",
      authType: "apikey",
      apiKey: "ollama-key",
      providerSpecificData: {},
    });
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("global fetch must not run")));
    const { __setProviderTestFetchForTesting, testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    const restore = __setProviderTestFetchForTesting(transport);

    try {
      const result = await testSingleConnection("conn-ollama");
      expect(result.valid).toBe(true);
      expect(transport).toHaveBeenCalledWith(
        "https://ollama.com/api/tags",
        expect.objectContaining({
          headers: { Authorization: "Bearer ollama-key" },
          signal: expect.any(AbortSignal),
        }),
        effectiveProxy,
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("routes local Ollama validation through proxy-aware bounded transport", async () => {
    const effectiveProxy = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
      vercelRelayUrl: "https://relay.example",
    };
    mocks.resolveConnectionProxyConfig.mockResolvedValue(effectiveProxy);
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-ollama-local",
      provider: "ollama-local",
      authType: "apikey",
      apiKey: "",
      providerSpecificData: { baseUrl: "http://ollama.internal:11434" },
    });
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("global fetch must not run")));
    const { __setProviderTestFetchForTesting, testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    const restore = __setProviderTestFetchForTesting(transport);

    try {
      const result = await testSingleConnection("conn-ollama-local");
      expect(result.valid).toBe(true);
      expect(transport).toHaveBeenCalledWith(
        "http://ollama.internal:11434/api/tags",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        effectiveProxy,
      );
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("provider dashboard search", () => {
  it("does not match an unnamed provider when search text is present", async () => {
    const { matchesProviderSearch } = await import(
      "../../src/app/(dashboard)/dashboard/providers/providerFilters.js"
    );

    expect(matchesProviderSearch(undefined, "open")).toBe(false);
    expect(matchesProviderSearch("OpenAI", "open")).toBe(true);
    expect(matchesProviderSearch(undefined, "   ")).toBe(true);
  });
});
