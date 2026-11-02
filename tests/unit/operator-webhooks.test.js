// #1118: signed operator event webhooks.
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ settings: {} }));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => structuredClone(store.settings)),
  updateSettings: vi.fn(async (updates) => {
    const current = structuredClone(store.settings);
    const patch = typeof updates === "function" ? updates(current) : updates;
    store.settings = { ...current, ...patch };
    return store.settings;
  }),
}));

const wh = await import("../../src/lib/webhooks/index.js");
const { SECRET_SETTING_KEYS } = await import("../../src/lib/settings/settingsPatchAuth.js");

const okFetch = (status = 200) => vi.fn(async () => new Response("", { status }));
const noSleep = vi.fn(async () => {});

beforeEach(() => {
  store.settings = {};
  wh.__test__.resetThrottle();
  noSleep.mockClear();
});

describe("signature", () => {
  it("verifies a fresh signature and rejects tampering and replay", () => {
    const now = 1_800_000_000;
    const header = wh.signWebhookBody("s3cret", now, '{"a":1}');
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(wh.verifyWebhookSignature("s3cret", header, '{"a":1}', { nowSec: now + 10 })).toBe(true);
    expect(wh.verifyWebhookSignature("s3cret", header, '{"a":2}', { nowSec: now })).toBe(false);
    expect(wh.verifyWebhookSignature("other", header, '{"a":1}', { nowSec: now })).toBe(false);
    expect(wh.verifyWebhookSignature("s3cret", header, '{"a":1}', { nowSec: now + 301 })).toBe(false);
    expect(wh.verifyWebhookSignature("s3cret", "garbage", '{"a":1}', { nowSec: now })).toBe(false);
  });
});

describe("destination validation", () => {
  it.each([
    "http://hooks.example.com/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://localhost/x",
    "https://user:pass@hooks.example.com/x",
    "ftp://hooks.example.com/x",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => wh.validateWebhookInput({ url, events: ["test.ping"] })).toThrow(wh.WebhookValidationError);
  });

  it("accepts a public https URL with known events only", () => {
    expect(wh.validateWebhookInput({ url: "https://hooks.example.com/x", events: ["quota.exhausted", "quota.exhausted"] }))
      .toEqual({ url: "https://hooks.example.com/x", events: ["quota.exhausted"] });
    expect(() => wh.validateWebhookInput({ url: "https://hooks.example.com/x", events: ["nope"] })).toThrow(/events/);
    expect(() => wh.validateWebhookInput({ url: "https://hooks.example.com/x", events: [] })).toThrow(/events/);
  });
});

describe("delivery", () => {
  const hook = { id: "h1", url: "https://hooks.example.com/in", secret: "k", events: ["test.ping"], enabled: true };
  const payload = { id: "d1", event: "test.ping", timestamp: "2026-11-02T00:00:00.000Z", data: {} };

  it("signs the exact body and sends identifying headers without following redirects", async () => {
    const fetcher = okFetch();
    const res = await wh.deliverWebhook(hook, payload, { fetcher, sleep: noSleep, nowSec: 1_800_000_000 });
    expect(res).toMatchObject({ ok: true, status: 200, attempts: 1 });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(hook.url);
    expect(init.redirect).toBe("manual");
    expect(init.headers["X-DurinDoor-Event"]).toBe("test.ping");
    expect(wh.verifyWebhookSignature("k", init.headers[wh.SIGNATURE_HEADER], init.body, { nowSec: 1_800_000_000 })).toBe(true);
  });

  it("releases the response body after reading the status", async () => {
    const cancel = vi.fn(async () => {});
    const fetcher = vi.fn(async () => ({ ok: true, status: 204, body: { cancel } }));
    const res = await wh.deliverWebhook(hook, payload, { fetcher, sleep: noSleep, nowSec: 1_800_000_000 });
    expect(res.ok).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx/429/network errors at most MAX_RETRIES times with backoff", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValue(new Response("", { status: 503 }));
    const res = await wh.deliverWebhook(hook, payload, { fetcher, sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(wh.MAX_RETRIES + 1);
    expect(noSleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(res).toMatchObject({ ok: false, status: 503, attempts: 4 });
  });

  it("does not retry 4xx or redirects", async () => {
    for (const status of [400, 302]) {
      const fetcher = okFetch(status);
      const res = await wh.deliverWebhook(hook, payload, { fetcher, sleep: noSleep });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(res.ok).toBe(false);
    }
  });

  it("never contacts a blocked destination and never retries a guard block", async () => {
    const fetcher = okFetch();
    const res = await wh.deliverWebhook({ ...hook, url: "https://192.168.1.10/x" }, payload, { fetcher, sleep: noSleep });
    expect(fetcher).not.toHaveBeenCalled();
    expect(noSleep).not.toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, attempts: 1 });
  });
});

describe("storage, dispatch, history", () => {
  const create = () => wh.createWebhook({ url: "https://hooks.example.com/in", events: ["account.cooldown"] });

  it("creates with a server-generated secret that is never exposed publicly", async () => {
    const hook = await create();
    expect(hook.secret).toMatch(/^[0-9a-f]{64}$/);
    const pub = wh.toPublicWebhook(hook);
    expect(pub.secret).toBeUndefined();
    expect(pub.hasSecret).toBe(true);
    expect(SECRET_SETTING_KEYS).toContain("operatorWebhooks");
  });

  it("redacts payload data, delivers only matching enabled events and records history", async () => {
    const hook = await create();
    const fetcher = okFetch();
    await wh.dispatchWebhookEvent("account.cooldown", { provider: "codex", apiKey: "sk-live-123", headers: { authorization: "Bearer x" } }, { fetcher, sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ event: "account.cooldown", data: { provider: "codex", apiKey: "[redacted]", headers: { authorization: "[redacted]" } } });
    expect(JSON.stringify(body)).not.toContain("sk-live-123");

    await wh.dispatchWebhookEvent("quota.exhausted", {}, { fetcher, sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(1); // not subscribed

    const [stored] = await wh.listWebhooks();
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0]).toMatchObject({ event: "account.cooldown", ok: true, status: 200 });
    expect(stored.id).toBe(hook.id);
  });

  it("throttles identical events per key", async () => {
    await create();
    const fetcher = okFetch();
    await wh.dispatchWebhookEvent("account.cooldown", {}, { throttleKey: "c1", fetcher, sleep: noSleep });
    await wh.dispatchWebhookEvent("account.cooldown", {}, { throttleKey: "c1", fetcher, sleep: noSleep });
    await wh.dispatchWebhookEvent("account.cooldown", {}, { throttleKey: "c2", fetcher, sleep: noSleep });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("bounds history and auto-disables after repeated failures; re-enable resets the streak", async () => {
    const hook = await create();
    const fetcher = okFetch(400);
    for (let i = 0; i < wh.AUTO_DISABLE_AFTER_FAILURES + 5; i++) {
      await wh.dispatchWebhookEvent("account.cooldown", {}, { fetcher, sleep: noSleep });
    }
    expect(fetcher).toHaveBeenCalledTimes(wh.AUTO_DISABLE_AFTER_FAILURES);
    let [stored] = await wh.listWebhooks();
    expect(stored.enabled).toBe(false);
    expect(stored.history.length).toBeLessThanOrEqual(wh.HISTORY_LIMIT);
    stored = await wh.updateWebhook(hook.id, { enabled: true });
    expect(stored).toMatchObject({ enabled: true, consecutiveFailures: 0 });
  });

  it("disabled destinations are skipped and delete removes them", async () => {
    const hook = await create();
    await wh.updateWebhook(hook.id, { enabled: false });
    const fetcher = okFetch();
    await wh.dispatchWebhookEvent("account.cooldown", {}, { fetcher, sleep: noSleep });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await wh.deleteWebhook(hook.id)).toBe(true);
    expect(await wh.deleteWebhook(hook.id)).toBe(false);
    expect(await wh.listWebhooks()).toEqual([]);
    expect(await wh.updateWebhook(hook.id, { enabled: true })).toBeNull();
  });

  it("is off by default and never throws", async () => {
    const fetcher = okFetch();
    expect(await wh.dispatchWebhookEvent("account.cooldown", {}, { fetcher })).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => wh.notifyWebhookEvent("account.cooldown", {})).not.toThrow();
  });
});
