import { describe, expect, it, vi } from "vitest";

const { handleRequest } = require("../../src/mitm/server.js");

function makeRequest({ url, method = "POST", host = "runtime.us-east-1.kiro.dev", body = "{}", headers = {} } = {}) {
  const data = Buffer.from(body);
  const listeners = {};
  return {
    url,
    method,
    headers: {
      host,
      "content-length": String(data.length),
      "content-type": "application/json",
      ...headers,
    },
    socket: { remotePort: 443 },
    on(event, fn) {
      listeners[event] = fn;
      if (event === "data") fn(data);
      if (event === "end") fn();
      return this;
    },
  };
}

function makeResponse() {
  const response = {
    status: null,
    body: null,
    writeHead(code, headers) { response.status = code; response.headers = headers; },
    end(value) { response.body = value; return response; },
  };
  return response;
}

const passthroughCalls = [];
const passthrough = (req, res, body) => { passthroughCalls.push({ req, body }); res.end("passthrough"); };
const allowPeer = async () => true;

describe("handleRequest routing for Kiro MITM", () => {
  it("dispatches Kiro GenerateAssistantResponse with modelId auto to the Kiro handler", async () => {
    passthroughCalls.length = 0;
    const kiroIntercept = vi.fn().mockResolvedValue();
    const requestHandlers = { kiro: { intercept: kiroIntercept } };
    const mappedOverrideFor = vi.fn().mockReturnValue({ model: "auto" });
    const req = makeRequest({
      url: "/",
      host: "runtime.us-east-1.kiro.dev",
      headers: { "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse" },
      body: JSON.stringify({ conversationState: { currentMessage: { userInputMessage: { modelId: "auto" } } } }),
    });
    const res = makeResponse();
    await handleRequest(req, res, { verifyPeerOwner: allowPeer, passthroughRequest: passthrough, requestHandlers, mappedOverrideFor });
    expect(mappedOverrideFor).toHaveBeenCalledWith("kiro", "auto");
    expect(kiroIntercept).toHaveBeenCalledTimes(1);
    const [, , body, modelId, passthroughArg] = kiroIntercept.mock.calls[0];
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(modelId).toBe("auto");
    expect(typeof passthroughArg).toBe("function");
    expect(passthroughCalls).toHaveLength(0);
  });

  it("passthrough when Kiro x-amz-target is not GenerateAssistantResponse", async () => {
    passthroughCalls.length = 0;
    const kiroIntercept = vi.fn();
    const requestHandlers = { kiro: { intercept: kiroIntercept } };
    const mappedOverrideFor = vi.fn();
    const req = makeRequest({
      url: "/",
      headers: { "x-amz-target": "AmazonCodeWhispererStreamingService.ListAvailableModels" },
      body: JSON.stringify({ conversationState: { currentMessage: { userInputMessage: { modelId: "auto" } } } }),
    });
    const res = makeResponse();
    await handleRequest(req, res, { verifyPeerOwner: allowPeer, passthroughRequest: passthrough, requestHandlers, mappedOverrideFor });
    expect(kiroIntercept).not.toHaveBeenCalled();
    expect(mappedOverrideFor).not.toHaveBeenCalled();
    expect(passthroughCalls).toHaveLength(1);
    expect(res.body).toBe("passthrough");
  });
});
