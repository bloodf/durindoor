import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import {
  MimocodeExecutor,
  MIMO_SYSTEM_MARKER,
  generateFingerprint,
  injectMimocodeSystemMarker,
  parseJwtExp,
} from "../../open-sse/executors/mimocode.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "../../open-sse/config/providerModels.js";
import { FREE_PROVIDERS } from "../../src/shared/constants/providers.js";

function jsonResponse(data, { ok = true, status = 200 } = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeJwt(expSec = Math.floor(Date.now() / 1000) + 3600) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url");
  return `${header}.${payload}.sig`;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("MimocodeExecutor", () => {
  it("generates deterministic 64-char fingerprints", () => {
    expect(generateFingerprint()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateFingerprint("seed-a")).toBe(generateFingerprint("seed-a"));
    expect(generateFingerprint("seed-a")).not.toBe(generateFingerprint("seed-b"));
  });

  it("parses JWT expiry and falls back for malformed tokens", () => {
    const exp = Math.floor(Date.now() / 1000) + 1200;
    expect(parseJwtExp(makeJwt(exp))).toBe(exp * 1000);
    expect(parseJwtExp("bad-token")).toBeGreaterThan(Date.now());
  });

  it("injects the MiMoCode anti-abuse marker once", () => {
    const first = injectMimocodeSystemMarker({ messages: [{ role: "user", content: "hi" }] });
    expect(first.messages[0].role).toBe("system");
    expect(first.messages[0].content).toContain(MIMO_SYSTEM_MARKER);

    const second = injectMimocodeSystemMarker(first);
    expect(second.messages.filter((message) => message.content?.includes?.(MIMO_SYSTEM_MARKER))).toHaveLength(1);
  });

  it("builds the chat endpoint, headers, and stripped model body", () => {
    const executor = new MimocodeExecutor();
    const transformed = executor.transformRequest("mcode/mimo-auto", {
      model: "mcode/mimo-auto",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(executor.buildUrl()).toBe("https://api.xiaomimimo.com/api/free-ai/openai/chat");
    expect(executor.buildHeaders({}, true)["X-Mimo-Source"]).toBe("mimocode-cli-free");
    expect(executor.buildHeaders({}, true).Accept).toContain("text/event-stream");
    expect(executor.buildHeaders({}, false).Accept).toBeUndefined();
    expect(transformed.model).toBe("mimo-auto");
    expect(transformed.messages[0].content).toContain(MIMO_SYSTEM_MARKER);
  });

  it("syncs configured fingerprints and per-account proxies", () => {
    const executor = new MimocodeExecutor();
    executor.syncAccountsFromCredentials({
      providerSpecificData: {
        fingerprints: ["fp-a", "fp-b"],
        accountProxies: [
          { fingerprint: "fp-a", proxy: { type: "http", host: "proxy-a.test", port: 8080 } },
          { fingerprint: "fp-b", proxy: { type: "https", host: "proxy-b.test" } },
        ],
      },
    });

    expect(executor.accounts.some((account) => account.fingerprint === "fp-a")).toBe(true);
    expect(executor.proxyUrlMap.get("fp-a")).toBe("http://proxy-a.test:8080");
    expect(executor.proxyUrlMap.get("fp-b")).toBe("https://proxy-b.test:443");
  });

  it("rejects SOCKS per-account proxies until a fetch-socks dispatcher is ported", () => {
    const executor = new MimocodeExecutor();
    expect(() => executor.syncAccountsFromCredentials({
      providerSpecificData: {
        accountProxies: [
          { fingerprint: "fp-socks", proxy: { type: "socks5", host: "proxy.test", port: 1080 } },
        ],
      },
    })).toThrow(/fetch-socks dispatcher/);
  });

  it("bootstraps a JWT, injects marker, and sends bearer auth to chat", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const executor = new MimocodeExecutor();
    const { response, headers, transformedBody } = await executor.execute({
      model: "mcode/mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: {},
    });

    expect(response.status).toBe(200);
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(transformedBody.messages[0].content).toContain(MIMO_SYSTEM_MARKER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).client).toBe(generateFingerprint());
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toMatch(/^Bearer /);
  });

  it("re-bootstraps and retries once after 403 auth failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
      .mockResolvedValueOnce(jsonResponse({ jwt: makeJwt() }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const { response } = await new MimocodeExecutor().execute({
      model: "mimo-auto",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: {},
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("registers Mimocode as a no-auth specialized provider and mcode alias", () => {
    expect(getExecutor("mimocode")).toBeInstanceOf(MimocodeExecutor);
    expect(getExecutor("mcode")).toBeInstanceOf(MimocodeExecutor);
    expect(PROVIDERS.mimocode.noAuth).toBe(true);
    expect(PROVIDER_ID_TO_ALIAS.mimocode).toBe("mcode");
    expect(PROVIDER_MODELS.mcode.map((model) => model.id)).toEqual(["mimo-auto"]);
    expect(FREE_PROVIDERS.mimocode.noAuth).toBe(true);
  });
});
