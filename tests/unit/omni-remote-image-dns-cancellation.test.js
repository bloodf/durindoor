import { afterEach, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
import { fetchImageAsBase64 } from "../../open-sse/translator/concerns/image.js";
import hf from "../../open-sse/handlers/imageProviders/huggingface.js";

const url = "https://example.com/reference.png";
const publicRecords = [{ address: "93.184.216.34", family: 4 }];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); lookup.mockReset(); });

it.each(["resolve", "reject"])("stops an input image on caller abort before DNS can %s", async (settle) => {
  const dns = deferred();
  lookup.mockReturnValueOnce(dns.promise);
  const fetch = vi.spyOn(globalThis, "fetch");
  const controller = new AbortController();
  const pending = hf.buildBody("black-forest-labs/FLUX.1-Kontext-dev", { prompt: "test", image: url }, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  dns[settle](settle === "resolve" ? publicRecords : new Error("DNS failed"));
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});

it("expires the image deadline while DNS is pending", async () => {
  vi.useFakeTimers();
  const dns = deferred();
  lookup.mockReturnValueOnce(dns.promise);
  const fetch = vi.spyOn(globalThis, "fetch");
  const pending = fetchImageAsBase64(url, { timeoutMs: 25 });
  await vi.advanceTimersByTimeAsync(25);
  await expect(pending).resolves.toBeNull();
  dns.resolve(publicRecords);
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});

it("fetches a validated DNS result and returns an image data URL", async () => {
  const dns = deferred();
  lookup.mockReturnValueOnce(dns.promise);
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  const pending = fetchImageAsBase64(url);
  dns.resolve(publicRecords);
  await expect(pending).resolves.toEqual({ url: "data:image/png;base64,iVBORw==", mimeType: "image/png" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual", dispatcher: expect.anything() });
});
