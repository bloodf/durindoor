import crypto from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";

const timestamp = 1710000000000;
const sessionID = "session-test-session";

function headersFor(credentials) {
  const executor = new IFlowExecutor();
  vi.spyOn(executor, "generateUUID").mockReturnValue("test-session");
  vi.spyOn(Date, "now").mockReturnValue(timestamp);
  return executor.buildHeaders(credentials, false);
}

function signatureFor(token) {
  return crypto
    .createHmac("sha256", token)
    .update(`iFlow-Cli:${sessionID}:${timestamp}`)
    .digest("hex");
}

afterEach(() => vi.restoreAllMocks());

describe("IFlowExecutor authorization", () => {
  it("prefers apiKey for Authorization and signature when both tokens exist", () => {
    const headers = headersFor({
      apiKey: "iflow-api-key",
      accessToken: "iflow-access-token",
    });

    expect(headers.Authorization).toBe("Bearer iflow-api-key");
    expect(headers["x-iflow-signature"]).toBe(signatureFor("iflow-api-key"));
  });

  it("uses accessToken for Authorization and signature when apiKey is absent", () => {
    const headers = headersFor({ accessToken: "iflow-access-token" });

    expect(headers.Authorization).toBe("Bearer iflow-access-token");
    expect(headers["x-iflow-signature"]).toBe(signatureFor("iflow-access-token"));
  });

  it("omits Authorization and signature when no token is configured", () => {
    const headers = headersFor({});

    expect(headers.Authorization).toBeUndefined();
    expect(headers["x-iflow-signature"]).toBe("");
  });
});
