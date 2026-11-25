// An abort that lands around browser.newContext() must stop the request before it drives a page.
// The browser is a local mock: no Chromium, Google account or network request is involved.
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { GeminiWebExecutor, resetGeminiBrowserLeaseForTests } from "../../open-sse/executors/gemini-web.js";

const context = { addCookies: vi.fn(async () => {}), newPage: vi.fn(), close: vi.fn(async () => {}) };
const newContext = vi.fn(async () => context);
const launch = vi.spyOn(chromium, "launch");

const run = (signal) => new GeminiWebExecutor().execute({
  model: "gemini-3.1-pro",
  body: { messages: [{ role: "user", content: "hello" }] },
  stream: false,
  credentials: { apiKey: "__Secure-1PSID=synthetic" },
  proxyOptions: { disableEnvProxy: true },
  signal,
});

afterEach(async () => {
  await resetGeminiBrowserLeaseForTests();
  vi.clearAllMocks();
});
afterAll(() => launch.mockRestore());

describe("gemini-web abort around context creation (OmniRoute #20739)", () => {
  it("creates no context when the abort lands during the browser launch", async () => {
    const controller = new AbortController();
    launch.mockImplementation(async () => {
      controller.abort();
      return { newContext, close: async () => {} };
    });

    const { response } = await run(controller.signal);

    expect(response.status).toBe(499);
    expect(newContext).not.toHaveBeenCalled();
  });

  it("closes a context whose creation was pending at the abort, before any page", async () => {
    const controller = new AbortController();
    launch.mockImplementation(async () => ({ newContext, close: async () => {} }));
    newContext.mockImplementationOnce(async () => {
      controller.abort();
      return context;
    });

    const { response } = await run(controller.signal);

    expect(response.status).toBe(499);
    expect(context.close).toHaveBeenCalled();
    expect(context.addCookies).not.toHaveBeenCalled();
    expect(context.newPage).not.toHaveBeenCalled();
  });
});
