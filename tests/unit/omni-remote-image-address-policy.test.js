import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

import cloudflare from "../../open-sse/handlers/imageProviders/cloudflareAi.js";
import huggingface from "../../open-sse/handlers/imageProviders/huggingface.js";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const base64 = png.toString("base64");
const dataUrl = `data:image/png;base64,${base64}`;
const url = "https://example.com/reference.png";
const cfModel = "@cf/runwayml/stable-diffusion-v1-5-img2img";
const hfModel = "black-forest-labs/FLUX.1-Kontext-dev";

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png)));
});
afterEach(() => vi.unstubAllGlobals());

describe("remote image adapter inputs", () => {
  it("fetches Cloudflare image and mask using pinned connections", async () => {
    const body = await cloudflare.buildBody(cfModel, { prompt: "test", image: url, mask: url });
    expect(body.image_b64).toBe(base64);
    expect(body.mask_b64).toBe(base64);
    expect(body.image).toEqual(Array.from(png));
    expect(body.mask).toEqual(Array.from(png));
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [target, options] of fetch.mock.calls) {
      expect(target).toBe(url);
      expect(options).toMatchObject({ redirect: "manual", dispatcher: expect.anything() });
    }
  });

  it.each(["image", "images"])("fetches a HuggingFace %s reference", async (field) => {
    const body = await huggingface.buildBody(hfModel, { prompt: "test", [field]: field === "images" ? [url] : url });
    expect(body.inputs).toBe(base64);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "manual", dispatcher: expect.anything() }));
  });

  it("preserves data URLs without fetching", async () => {
    const cf = await cloudflare.buildBody(cfModel, { prompt: "test", image: dataUrl, mask: dataUrl });
    const hf = await huggingface.buildBody(hfModel, { prompt: "test", image: dataUrl });
    expect(cf.image_b64).toBe(base64);
    expect(cf.mask_b64).toBe(base64);
    expect(hf.inputs).toBe(base64);
    expect(fetch).not.toHaveBeenCalled();
  });
});
