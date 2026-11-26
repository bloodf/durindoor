import "../translator/registerAll.js";
import { describe, expect, it, vi } from "vitest";
import { prefetchRemoteImages } from "../../open-sse/translator/concerns/prefetch.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// IP literals skip DNS, and the injected fetcher keeps the test offline.
const PUBLIC_URL = "https://93.184.216.34/photo.jpg";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const fetcher = () => vi.fn(async () => new Response(JPEG, { status: 200 }));
const image = (url) => ({ type: "input_image", image_url: url });
const message = (url) => ({ type: "message", role: "user", content: [{ type: "input_text", text: "what is this?" }, image(url)] });

describe("OmniRoute #20001 - inline remote image URLs for Antigravity", () => {
  it("sends a Responses input_image URL to Antigravity as typed inlineData", async () => {
    const body = { model: "gemini-3.1-pro-low", input: [message(PUBLIC_URL)] };
    expect(await prefetchRemoteImages(body, FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, { fetcher: fetcher() })).toBe(1);

    const wire = JSON.stringify(translateRequest(FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, "gemini-3.1-pro-low", body, false, { projectId: "p" }, "antigravity"));
    expect(wire).toContain(`"inlineData":{"mimeType":"image/jpeg","data":"${JPEG.toString("base64")}"}`);
    expect(wire).not.toContain("fileData");
  });

  it("inlines object-form URLs and tool-output images", async () => {
    const body = { input: [
      { type: "message", role: "user", content: [{ type: "input_image", image_url: { url: PUBLIC_URL } }] },
      { type: "function_call_output", call_id: "c1", output: [image(PUBLIC_URL)] },
    ] };
    expect(await prefetchRemoteImages(body, FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, { fetcher: fetcher() })).toBe(2);
    expect(body.input[0].content[0].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(body.input[1].output[0].image_url).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("never fetches a private destination and drops an oversized image", async () => {
    const guarded = fetcher();
    const privateBody = { input: [message("http://127.0.0.1/secret.png")] };
    expect(await prefetchRemoteImages(privateBody, FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, { fetcher: guarded })).toBe(0);
    expect(guarded).not.toHaveBeenCalled();

    const bigBody = { input: [message(PUBLIC_URL)] };
    expect(await prefetchRemoteImages(bigBody, FORMATS.OPENAI_RESPONSES, FORMATS.ANTIGRAVITY, { fetcher: fetcher(), maxBytes: JPEG.length - 1 })).toBe(0);
    expect(bigBody.input[0].content[1].image_url).toBe(PUBLIC_URL);
  });
});
