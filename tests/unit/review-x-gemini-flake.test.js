import { afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

const STREAM_URL = "https://gemini.google.com/_/StreamGenerate";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.restoreAllMocks();
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
                    text: async () => `)]}'\n\n1\n[["wrb.fr",null,"[null,null,null,null,[[\"c\",[\"ok\"]]]]]]\n`,
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
      model: "gemini-2.5-pro",
      body: { messages: [{ role: "user", content: `request ${index}` }] },
      stream: false,
      credentials: { apiKey: `__Secure-1PSID=synthetic-${index}` },
    }));
    const results = await Promise.all(requests);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(contexts).toHaveLength(20);
    expect(contexts.every((context) => context.closed)).toBe(true);
    expect(results.every(({ response }) => response.status === 200)).toBe(true);
  });
});
