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

async function startXaiAttempt() {
  const attempt = new XaiService().connect();
  await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
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

    await callbackRequest(flow.port, "/callback?error=access_denied");

    await expect(waiting).rejects.toThrow("access_denied");
    await expectPortReusable(flow.port);
  });

  it.sequential("releases the fixed listener after an error callback", async () => {
    const { attempt } = await startXaiAttempt();

    await callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?error=access_denied`);

    await expect(attempt).rejects.toThrow("access_denied");
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener when callback code is missing", async () => {
    const { attempt } = await startXaiAttempt();

    await callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?state=state-only`);

    await expect(attempt).rejects.toThrow("No authorization code received");
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener when callback state is missing", async () => {
    const { attempt } = await startXaiAttempt();

    await callbackRequest(XAI_CONFIG.loopbackPort, `${XAI_CONFIG.callbackPath}?code=oauth-code`);

    await expect(attempt).rejects.toThrow("Invalid state parameter");
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after token exchange failure", async () => {
    const { attempt } = await startXaiAttempt();
    fetch.mockResolvedValueOnce({ ok: false, text: async () => "exchange rejected" });
    const state = new URL(mocks.open.mock.calls[0][0]).searchParams.get("state");

    await callbackRequest(
      XAI_CONFIG.loopbackPort,
      `${XAI_CONFIG.callbackPath}?code=oauth-code&state=${encodeURIComponent(state)}`,
    );

    await expect(attempt).rejects.toThrow("xAI token exchange failed: exchange rejected");
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after a downstream save failure", async () => {
    const service = new XaiService();
    const saveTokens = vi.fn().mockRejectedValueOnce(new Error("save rejected"));
    vi.spyOn(service, "exchangeXaiCode").mockImplementationOnce(async () => {
      await saveTokens();
    });
    const attempt = service.connect();
    await vi.waitFor(() => expect(mocks.open).toHaveBeenCalledOnce());
    const state = new URL(mocks.open.mock.calls[0][0]).searchParams.get("state");

    await callbackRequest(
      XAI_CONFIG.loopbackPort,
      `${XAI_CONFIG.callbackPath}?code=oauth-code&state=${encodeURIComponent(state)}`,
    );

    await expect(attempt).rejects.toThrow("save rejected");
    expect(saveTokens).toHaveBeenCalledOnce();
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });

  it.sequential("releases the fixed listener after callback timeout", async () => {
    vi.useFakeTimers();
    const { attempt } = await startXaiAttempt();
    const rejected = expect(attempt).rejects.toThrow("Authentication timeout (5 minutes)");

    await vi.advanceTimersByTimeAsync(300_000);

    await rejected;
    vi.useRealTimers();
    await expectPortReusable(XAI_CONFIG.loopbackPort);
  });
});
