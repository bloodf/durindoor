import http from "http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("open", () => ({ default: mocks.open }));
vi.mock("@/lib/oauth/utils/ui.js", () => ({
  spinner: vi.fn(() => {
    const spinner = {
      text: "",
      start: vi.fn(),
      stop: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
    };
    spinner.start.mockReturnValue(spinner);
    return spinner;
  }),
}));

import { XAI_CONFIG } from "@/lib/oauth/constants/xai.js";
import { OAuthService } from "@/lib/oauth/services/oauth.js";
import { XaiService } from "@/lib/oauth/services/xai.js";
import { startLocalServer } from "@/lib/oauth/utils/server.js";

function callbackRequest(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path }, (response) => {
      response.resume();
      response.on("end", resolve);
    });
    request.on("error", reject);
  });
}

async function expectPortReusable(port) {
  const rebound = await startLocalServer(() => {}, port);
  await new Promise((resolve, reject) => rebound.server.close((error) => error ? reject(error) : resolve()));
}

async function startXaiAttempt(service = new XaiService()) {
  const attempt = service.connect();
  await Promise.race([attempt, vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce())]);
  return { attempt };
}

describe("OAuth callback listener cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.open.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url).includes(".well-known")) {
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
            token_endpoint: "https://auth.x.ai/oauth2/token",
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("releases the generic listener after an error callback", async () => {
    const flow = await new OAuthService({}).startAuthFlow(null, "test provider");
    const waiting = flow.waitForCallback();

    await Promise.all([
      expect(waiting).rejects.toThrow("access_denied"),
      callbackRequest(flow.port, "/callback?error=access_denied"),
    ]);
    await expectPortReusable(flow.port);
  });

  it.sequential("releases the fixed listener after an error callback", async () => {
    const { attempt } = await startXaiAttempt();

    await Promise.all([
      expect(attempt).rejects.toThrow("access_denied"),
      callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?error=access_denied`),
    ]);
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener when callback code is missing", async () => {
    const { attempt } = await startXaiAttempt();

    await Promise.all([
      expect(attempt).rejects.toThrow("No authorization code received"),
      callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?state=state-only`),
    ]);
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener when callback state is missing", async () => {
    const { attempt } = await startXaiAttempt();

    await Promise.all([
      expect(attempt).rejects.toThrow("Invalid state parameter"),
      callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?code=oauth-code`),
    ]);
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after token exchange failure", async () => {
    const { attempt } = await startXaiAttempt();
    fetch.mockResolvedValueOnce({ ok: false, text: async () => "exchange rejected" });
    const state = new URL(mocks.open.mock.calls[0][0]).searchParams.get("state");

    await Promise.all([
      expect(attempt).rejects.toThrow("xAI token exchange failed: exchange rejected"),
      callbackRequest(
        XAI_CONFIG.loopbackPort,
        `${XAI_CONFIG.callbackPath}?code=oauth-code&state=${encodeURIComponent(state)}`,
      ),
    ]);
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after a downstream save failure", async () => {
    const service = new XaiService();
    const saveTokens = vi.fn().mockRejectedValueOnce(new Error("save rejected"));
    vi.spyOn(service, "exchangeXaiCode").mockImplementationOnce(async () => {
      await saveTokens();
    });
    const { attempt } = await startXaiAttempt(service);
    const state = new URL(mocks.open.mock.calls[0][0]).searchParams.get("state");

    await Promise.all([
      expect(attempt).rejects.toThrow("save rejected"),
      callbackRequest(
        XAI_CONFIG.loopbackPort,
        `${XAI_CONFIG.callbackPath}?code=oauth-code&state=${encodeURIComponent(state)}`,
      ),
    ]);
    expect(saveTokens).toHaveBeenCalledOnce();
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after callback timeout", async () => {
    // Keep listener startup on real time and hold the browser launch until
    // the fake clock is ready to measure the full callback deadline.
    const browserLaunch = Promise.withResolvers();
    mocks.open.mockReturnValueOnce(browserLaunch.promise);
    const { attempt } = await startXaiAttempt();
    vi.useFakeTimers();
    const rejected = expect(attempt).rejects.toThrow("Authentication timeout (5 minutes)");
    browserLaunch.resolve();
    // Let connect() register the callback timers after its await of open().
    await Promise.resolve();

    // A synchronous advance avoids a real event-loop turn for each poll.
    vi.advanceTimersByTime(299_999);
    const timersBeforeDeadline = vi.getTimerCount();
    vi.advanceTimersByTime(1);

    await rejected;
    expect(timersBeforeDeadline).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });
});
