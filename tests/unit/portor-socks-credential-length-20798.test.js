// SOCKS5 writes each credential behind a one-byte length. An over-long value
// throws inside the socket handler, so the relay must refuse it before dialing.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { assertSocksProxyUrl, SOCKS_CREDENTIAL_TOO_LONG } from "../../open-sse/utils/socksCredential.js";

const require = createRequire(import.meta.url);
const { createNativeRealtimeRelay } = require("../../open-sse/handlers/nativeRealtimeRelay.js");

function client() {
  const socket = new EventEmitter();
  Object.assign(socket, { readyState: 1, OPEN: 1, bufferedAmount: 0, send() {}, close() {} });
  return socket;
}

function upstream() {
  const socket = new EventEmitter();
  Object.assign(socket, { readyState: 0, OPEN: 1, bufferedAmount: 0, send() {}, close() {} });
  return socket;
}

function relay(url, agentFactory) {
  return createNativeRealtimeRelay({
    client: client(),
    wsUrl: "wss://example.invalid/realtime",
    authorization: "Bearer t",
    proxy: { enabled: true, url },
    agentFactory,
    webSocketFactory: () => upstream(),
  });
}

describe("SOCKS5 credential length (#20798)", () => {
  it("rejects an oversized socks5 password before the agent factory", async () => {
    let dialed = false;
    await expect(relay(`socks5://user:${"a".repeat(256)}@127.0.0.1:1080`, async () => {
      dialed = true;
      return {};
    })).rejects.toMatchObject({
      message: "native realtime proxy unavailable",
      cause: { code: SOCKS_CREDENTIAL_TOO_LONG },
    });
    expect(dialed).toBe(false);
  });

  it("dials socks5 at 255 bytes and socks4 past that limit", async () => {
    let socks5 = false;
    const allowed = await relay(`socks5://user:${"b".repeat(255)}@127.0.0.1:1080`, async () => {
      socks5 = true;
      return {};
    });
    expect(socks5).toBe(true);
    const socks5Opened = allowed.opened.catch(() => {});
    await allowed.dispose();
    await socks5Opened;

    let socks4 = false;
    const legacy = await relay(`socks4://${"u".repeat(256)}:pw@127.0.0.1:1080`, async () => {
      socks4 = true;
      return {};
    });
    expect(socks4).toBe(true);
    const socks4Opened = legacy.opened.catch(() => {});
    await legacy.dispose();
    await socks4Opened;
  });

  it("checks decoded UTF-8 length and ignores non-SOCKS5 URLs", () => {
    expect(() => assertSocksProxyUrl(`socks5h://user:${encodeURIComponent("é".repeat(128))}@127.0.0.1:1080`)).toThrow(expect.objectContaining({ code: SOCKS_CREDENTIAL_TOO_LONG }));
    expect(() => assertSocksProxyUrl("socks5://127.0.0.1:1080")).not.toThrow();
    expect(() => assertSocksProxyUrl("http://user:secret@127.0.0.1:8080")).not.toThrow();
    expect(() => assertSocksProxyUrl("not a url")).not.toThrow();
  });
});
