/**
 * Upstream 9router #5350: the Cloudflare FLUX.2 models take a single
 * reference image as a binary multipart file part (`input_image_0`). The
 * adapter dropped the reference before, so FLUX.2 answered from the prompt
 * alone.
 *
 * The reference may be a data URI, raw base64, a byte array or a remote URL.
 * A remote URL is pulled through the guarded image fetcher, so a private
 * address or a disguised non-image payload is refused instead of uploaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));

const { default: cloudflareAi } = await import("../../open-sse/handlers/imageProviders/cloudflareAi.js");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DATA_URL = `data:image/png;base64,${PNG.toString("base64")}`;
const FLUX_MODELS = [
  "@cf/black-forest-labs/flux-2-dev",
  "@cf/black-forest-labs/flux-2-klein-4b",
  "@cf/black-forest-labs/flux-2-klein-9b",
];

const build = (model, body) => cloudflareAi.buildBody(model, { prompt: "make it a watercolor", ...body });

beforeEach(() => {
  lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(PNG, { headers: { "Content-Type": "image/png" } })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Cloudflare FLUX.2 reference image", () => {
  it.each(FLUX_MODELS)("sends a data URI reference as input_image_0 (%s)", async (model) => {
    const form = await build(model, { image: DATA_URL });

    const file = form.get("input_image_0");
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    expect(form.get("prompt")).toBe("make it a watercolor");
  });

  it("sends raw base64 and byte-array references as input_image_0", async () => {
    for (const image of [PNG.toString("base64"), Array.from(PNG)]) {
      const form = await build(FLUX_MODELS[0], { image });
      const file = form.get("input_image_0");
      expect(file).toBeInstanceOf(Blob);
      expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    }
  });

  it("fetches a remote reference through the guarded fetcher", async () => {
    const form = await build(FLUX_MODELS[0], { image: "https://example.com/reference.png" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://example.com/reference.png");
    // The guarded fetcher pins the connection and refuses redirects.
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "manual" });

    const file = form.get("input_image_0");
    expect(file.type).toBe("image/png");
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("refuses a private-address reference without uploading anything", async () => {
    lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    await expect(build(FLUX_MODELS[0], { image: "https://internal.example/reference.png" }))
      .rejects.toThrow("Unable to fetch reference image safely");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a failed download instead of generating without the reference", async () => {
    fetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));

    await expect(build(FLUX_MODELS[0], { image: "https://example.com/missing.png" }))
      .rejects.toThrow("Unable to fetch reference image safely");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an unsupported shape", { unexpected: "shape" }],
    ["a byte above the range", [256]],
    ["a negative byte", [-1]],
    ["a fractional byte", [1.5]],
    ["a null byte", [null]],
    ["a boolean byte", [true]],
    ["a nested byte array", [Array.from(PNG)]],
    ["a sparse byte array", new Array(1)],
    ["a numeric string", ["137"]],
  ])("rejects %s as a reference image", async (_name, image) => {
    await expect(build(FLUX_MODELS[0], { image })).rejects.toThrow("Invalid reference image");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a single reference in images", { images: [DATA_URL] }],
    ["several references in images", { images: [DATA_URL, DATA_URL] }],
    ["both image and images", { image: DATA_URL, images: [DATA_URL] }],
    ["a non-array images value", { images: DATA_URL }],
  ])("rejects %s instead of dropping references", async (_name, body) => {
    await expect(build(FLUX_MODELS[0], body))
      .rejects.toThrow("FLUX.2 expects a single reference in image; images is not supported");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([[null], [[]]])("keeps a prompt-only request with empty images (%j)", async (images) => {
    const form = await build(FLUX_MODELS[0], { images });

    expect(form.get("input_image_0")).toBeNull();
    expect(form.get("prompt")).toBe("make it a watercolor");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps prompt-only FLUX.2 requests and their options unchanged", async () => {
    const form = await build(FLUX_MODELS[0], { size: "1024x768", seed: 0, guidance: 3.5 });

    expect(Object.fromEntries(form)).toEqual({
      prompt: "make it a watercolor", width: "1024", height: "768", seed: "0", guidance: "3.5",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the existing JSON img2img contract unchanged", async () => {
    const body = await cloudflareAi.buildBody("@cf/runwayml/stable-diffusion-v1-5-img2img", {
      prompt: "make it a watercolor", image: DATA_URL,
    });

    expect(body.image).toEqual(Array.from(PNG));
    expect(body.image_b64).toBe(PNG.toString("base64"));
    expect(fetch).not.toHaveBeenCalled();
  });
});
