import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  resolveConnectProxyForRequest: () => ({ proxyUrl: null }),
}));

const STREAM_URL = "https://gemini.google.com/_/StreamGenerate";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const frameBody = (answer) => `)]}'\n\n1\n${JSON.stringify([["wrb.fr", null, JSON.stringify([null, null, null, null, [["c", [answer]]]])]])}\n`;

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Gemini Web concurrent browser lease", () => {
  it("shares one slow launch across 20 requests and closes contexts before they resolve", async () => {
    const contexts = [];
    const launch = vi.spyOn(chromium, "launch").mockImplementation(async () => {
      await delay(30);
      return {
        isConnected: () => true,
        close: vi.fn(async () => {}),
        newContext: vi.fn(async () => {
          const state = { closed: false };
          contexts.push(state);
          return {
            addCookies: async () => {},
            cookies: async () => [],
            close: async () => { await delay(5); state.closed = true; },
            newPage: async () => {
              let responseHandler;
              return {
                on: (_event, handler) => { responseHandler = handler; },
                url: () => "https://gemini.google.com/app",
                goto: async () => ({ status: () => 200 }),
                waitForSelector: async () => ({ click: async () => {} }),
                keyboard: {
                  insertText: async () => {},
                  press: async () => responseHandler({
                    url: () => STREAM_URL,
                    status: () => 200,
                    text: async () => frameBody("ok"),
                  }),
                },
                waitForTimeout: async () => {},
              };
            },
          };
        }),
      };
    });

    const executor = new GeminiWebExecutor();
    const requests = Array.from({ length: 20 }, (_, index) => executor.execute({
      body: { messages: [{ role: "user", content: `request ${index}` }] },
      stream: false,
      credentials: { apiKey: `__Secure-1PSID=synthetic-${index}` },
    }));
    const results = await Promise.all(requests);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(20);
    expect(contexts.every((context) => context.closed)).toBe(true);
    expect(results.map(({ response }) => response.status)).toEqual(Array(20).fill(200));
  });

  it("clears the lease count when a launcher throws synchronously", async () => {
    vi.useFakeTimers();
    const browser = {
      isConnected: () => true,
      close: vi.fn(async () => {}),
      newContext: async () => { throw new Error("context setup failed"); },
    };
    const launch = vi.spyOn(chromium, "launch")
      .mockImplementationOnce(() => { throw new Error("launcher failed synchronously"); })
      .mockResolvedValueOnce(browser);
    const executor = new GeminiWebExecutor();
    const input = {
      body: { messages: [{ role: "user", content: "hello" }] },
      credentials: { apiKey: "__Secure-1PSID=synthetic" },
    };

    await executor.execute(input);
    await executor.execute(input);
    expect(launch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(browser.close).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
