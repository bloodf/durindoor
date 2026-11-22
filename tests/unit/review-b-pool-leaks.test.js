/**
 * Regression coverage for #2247 — browser pool / Obscura / TLS-client leaks.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();
const tlsClients = [];
const tlsMockControl = { failNextStart: false };

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: (...args) => spawnMock(...args) };
});

vi.mock("playwright", () => ({ chromium: { launch: vi.fn(), connectOverCDP: vi.fn() } }));

vi.mock("tls-client-node", () => ({
  TLSClient: class {
    constructor() {
      this.stopped = false;
      tlsClients.push(this);
    }
    async start() {
      if (tlsMockControl.failNextStart) {
        tlsMockControl.failNextStart = false;
        throw new Error("start failed");
      }
    }
    stop() {
      this.stopped = true;
    }
    async request() {
      return { status: 200, headers: {}, body: "{}" };
    }
  },
}));

import { chromium } from "playwright";
import {
  acquireBrowserContext,
  getBrowserPoolStatus,
  releaseBrowserContext,
  shutdownPool,
} from "open-sse/services/browserPool.js";
import {
  ensureObscuraServer,
  killSharedObscuraServer,
} from "open-sse/services/obscura.js";
import {
  createGetClient,
  createTlsClientModule,
  raceWithTimeout,
  TlsClientHangError,
} from "open-sse/services/tlsClientBase.js";

function createFakeChild() {
  const child = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function createBrowser({ beforeNewContext } = {}) {
  let connected = true;
  const contexts = [];
  return {
    isConnected: () => connected,
    async newContext() {
      if (beforeNewContext) await beforeNewContext();
      let closed = false;
      const pages = [];
      const context = {
        isClosed: () => closed,
        pages: () => pages,
        async addCookies() {},
        async addInitScript() {},
        async newPage() {
          let pageClosed = false;
          const page = {
            isClosed: () => pageClosed,
            async goto() {},
            async close() {
              pageClosed = true;
            },
          };
          pages.push(page);
          return page;
        },
        async close() {
          closed = true;
          await Promise.all(pages.map((page) => page.close()));
        },
      };
      contexts.push(context);
      return context;
    },
    async close() {
      connected = false;
      await Promise.all(contexts.map((context) => context.close()));
    },
    _contexts: contexts,
  };
}

describe("obscura shared child lifecycle (#2247)", () => {
  const prevBin = process.env.OBSCURA_BIN;
  const prevEndpoint = process.env.OBSCURA_CDP_ENDPOINT;
  const prevPort = process.env.OBSCURA_PORT;
  let fetchSpy;

  beforeEach(() => {
    killSharedObscuraServer();
    spawnMock.mockReset();
    delete process.env.OBSCURA_CDP_ENDPOINT;
    process.env.OBSCURA_BIN = "/tmp/fake-obscura-bin";
    process.env.OBSCURA_PORT = "39999";
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    killSharedObscuraServer();
    fetchSpy?.mockRestore();
    spawnMock.mockReset();
    if (prevBin === undefined) delete process.env.OBSCURA_BIN;
    else process.env.OBSCURA_BIN = prevBin;
    if (prevEndpoint === undefined) delete process.env.OBSCURA_CDP_ENDPOINT;
    else process.env.OBSCURA_CDP_ENDPOINT = prevEndpoint;
    if (prevPort === undefined) delete process.env.OBSCURA_PORT;
    else process.env.OBSCURA_PORT = prevPort;
  });

  it("registers a process exit hook that kills the shared child", async () => {
    const child = createFakeChild();
    spawnMock.mockReturnValue(child);
    const exitBefore = process.listenerCount("exit");

    const server = await ensureObscuraServer();
    expect(server?.child).toBe(child);
    expect(process.listenerCount("exit")).toBeGreaterThan(exitBefore);

    const listeners = process.listeners("exit").slice(exitBefore);
    for (const listener of listeners) {
      listener();
    }
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("clears shared state when the child exits so the next ensure can respawn", async () => {
    const child1 = createFakeChild();
    const child2 = createFakeChild();
    spawnMock.mockReturnValueOnce(child1).mockReturnValueOnce(child2);

    const first = await ensureObscuraServer();
    expect(first?.child).toBe(child1);

    child1.emit("exit", 1, null);

    const second = await ensureObscuraServer();
    expect(second?.child).toBe(child2);
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});

describe("browser pool create/release leaks (#2247)", () => {
  beforeEach(async () => {
    await shutdownPool("test-setup");
    chromium.launch.mockReset();
    chromium.launch.mockImplementation(async () => createBrowser());
    spawnMock.mockImplementation(() => {
      const child = createFakeChild();
      queue.setImmediate(() => child.emit("exit", 1, null));
      return child;
    });
  });

  afterEach(async () => {
    await shutdownPool("test-cleanup");
    vi.clearAllMocks();
  });

  it("closes the half-built context and browser when context seeding throws", async () => {
    const browser = createBrowser();
    chromium.launch.mockImplementation(async () => browser);

    await expect(
      acquireBrowserContext("seed-fail", {
        localStorage: { token: "x" },
      })
    ).rejects.toThrow();

    expect(browser._contexts.every((ctx) => ctx.isClosed())).toBe(true);
    expect(getBrowserPoolStatus().browserRunning).toBe(false);
  });

  it("does not shut down while a concurrent context creation is pending", async () => {
    let releaseGate;
    const gate = new Promise((resolve) => {
      releaseGate = resolve;
    });
    let contextCalls = 0;
    chromium.launch.mockImplementation(async () =>
      createBrowser({
        beforeNewContext: async () => {
          contextCalls += 1;
          if (contextCalls === 2) await gate;
        },
      })
    );

    await acquireBrowserContext("keep-alive", {});
    const pendingSecond = acquireBrowserContext("in-flight", {});
    await vi.waitFor(() => expect(contextCalls).toBe(2));

    await releaseBrowserContext("keep-alive");
    releaseGate();

    await expect(pendingSecond).resolves.toMatchObject({ id: "headless:in-flight" });
    expect(getBrowserPoolStatus().browserRunning).toBe(true);
  });

  it("settlePendingContext only deletes its own pending entry", async () => {
    let releaseFirst;
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let contextCalls = 0;
    chromium.launch.mockImplementation(async () =>
      createBrowser({
        beforeNewContext: async () => {
          contextCalls += 1;
          if (contextCalls === 1) await firstGate;
        },
      })
    );

    const first = acquireBrowserContext("same-key", {});
    await vi.waitFor(() => expect(contextCalls).toBe(1));

    await shutdownPool("interrupt-first");
    const second = acquireBrowserContext("same-key", {});
    await vi.waitFor(() => expect(contextCalls).toBe(2));

    releaseFirst();
    await expect(first).rejects.toThrow();

    const joined = acquireBrowserContext("same-key", {});
    const [a, b] = await Promise.all([second, joined]);
    expect(a).toBe(b);
    expect(contextCalls).toBe(2);
  });
});

describe("tlsClientBase cache / timer leaks (#2247)", () => {
  beforeEach(() => {
    tlsClients.length = 0;
    tlsMockControl.failNextStart = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the timeout timer when the raced promise wins without a signal", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await expect(raceWithTimeout(Promise.resolve("ok"), 60_000, null)).resolves.toBe("ok");
    expect(clearSpy).toHaveBeenCalled();
  });

  it("clears a rejected start() promise so the next getClient call retries", async () => {
    const getClient = createGetClient({ providerName: "retry-start", tlsProfile: "chrome" });
    tlsMockControl.failNextStart = true;

    await expect(getClient()).rejects.toThrow("start failed");
    const client = await getClient();
    expect(client.stopped).toBe(false);
    getClient.resetClientCache();
  });

  it("stop()s the old client on resetClientCache and registers a single exit listener", async () => {
    const getClient = createGetClient({ providerName: "reset-stop", tlsProfile: "chrome" });
    const exitBefore = process.listenerCount("exit");

    const first = await getClient();
    const afterFirst = process.listenerCount("exit");
    expect(afterFirst).toBe(exitBefore + 1);

    getClient.resetClientCache();
    expect(first.stopped).toBe(true);

    const second = await getClient();
    expect(second).not.toBe(first);
    expect(process.listenerCount("exit")).toBe(afterFirst);

    const mod = createTlsClientModule({
      providerName: "hang-reset",
      tlsProfile: "chrome",
      domain: "example.test",
      tempDirPrefix: "tls-b-pool-",
      tailFileVariant: "A",
      responseValidation: "sse",
      defaultTimeoutMs: 10,
      hardTimeoutGraceMs: 5,
    });

    // Make requests hang so raceWithTimeout triggers resetClientCache.
    for (const client of tlsClients) {
      client.request = () => new Promise(() => {});
    }
    const origPush = Array.prototype.push;
    const trackedPush = function pushClient(client) {
      client.request = () => new Promise(() => {});
      return origPush.call(this, client);
    };
    tlsClients.push = trackedPush;

    const hangExitBefore = process.listenerCount("exit");
    await expect(
      mod.tlsFetch("https://example.test/", { method: "GET", timeoutMs: 5 })
    ).rejects.toBeInstanceOf(TlsClientHangError);
    await expect(
      mod.tlsFetch("https://example.test/", { method: "GET", timeoutMs: 5 })
    ).rejects.toBeInstanceOf(TlsClientHangError);

    expect(process.listenerCount("exit")).toBe(hangExitBefore + 1);
    expect(tlsClients.some((c) => c.stopped)).toBe(true);
    tlsClients.push = origPush.bind(tlsClients);
  });
});
