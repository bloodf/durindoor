/**
 * Unit tests for image generation handler
 *
 * Covers:
 *  - OpenAI-compatible format (openai, minimax, openrouter)
 *  - Gemini format (generateContent API)
 *  - Provider-specific formats (nanobanana, sdwebui)
 *  - Response normalization to OpenAI format
 *  - Error handling (missing prompt, invalid model)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

describe("handleImageGenerationCore", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("validates required prompt field", async () => {
    const result = await handleImageGenerationCore({
      body: { model: "openai/dall-e-3" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("Missing required field: prompt");
  });

  it("rejects unsupported provider", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "unknown-provider", model: "test" },
      credentials: null,
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("does not support image generation");
  });

  it("generates image with OpenAI format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/image.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A cute cat", n: 1, size: "1024x1024" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
        body: expect.stringContaining('"prompt":"A cute cat"'),
      })
    );


    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(1);
    expect(responseBody.data[0].url).toBe("https://example.com/image.png");
  });
  it("routes Together images through its OpenAI-compatible endpoint", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: 1, data: [{ url: "https://example.com/together.png" }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await handleImageGenerationCore({ body: { prompt: "A lantern" }, modelInfo: { provider: "together", model: "google/flash-image-2.5" }, credentials: { apiKey: "test-key" }, log: null });
    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith("https://api.together.ai/v1/images/generations", expect.objectContaining({ method: "POST" }));
  });

  it("maps Together image size and native options", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ id: "i", model: "google/flash-image-2.5", object: "list", data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await handleImageGenerationCore({ body: { prompt: "A lantern", size: "1280x720", steps: 30, seed: 7, negative_prompt: "blur", guidance_scale: 8, reference_images: ["https://example.com/ref.png"] }, modelInfo: { provider: "together", model: "google/flash-image-2.5" }, credentials: { apiKey: "test-key" }, log: null });
    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.together.ai/v1/images/generations");
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ model: "google/flash-image-2.5", prompt: "A lantern", width: 1280, height: 720, steps: 30, seed: 7, negative_prompt: "blur", guidance_scale: 8, reference_images: ["https://example.com/ref.png"] });
  });

  it("forwards current GPT Image generation fields", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ created: 1, data: [] }), { headers: { "Content-Type": "application/json" } }));
    await handleImageGenerationCore({
      body: { prompt: "A transparent icon", background: "transparent", output_format: "webp", output_compression: 80, moderation: "low" },
      modelInfo: { provider: "openai", model: "gpt-image-2.5-sunburst" },
      credentials: { apiKey: "test-key" },
      log: null,
    });
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ background: "transparent", output_format: "webp", output_compression: 80, moderation: "low" });
  });

  it("generates image with Gemini format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: "Generated image" },
                  { inlineData: { data: "base64imagedata" } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A sunset" },
      modelInfo: { provider: "gemini", model: "gemini-image-preview" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"responseModalities":["TEXT","IMAGE"]'),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(1);
    expect(responseBody.data[0].b64_json).toBe("base64imagedata");
  });

  // OmniRoute #7108 (upstream #2482): MiniMax image_generation is not
  // OpenAI-compatible — request uses aspect_ratio on the dedicated
  // /v1/image_generation endpoint; response nests URLs under data.image_urls.
  it("generates image with MiniMax native format (dispatch + auth + request shape)", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "abc123",
          data: { image_urls: ["https://cdn.minimax.io/generated/one.png"] },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain", size: "16:9", n: 2 },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/image_generation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
        body: JSON.stringify({
          model: "image-01",
          prompt: "A mountain",
          aspect_ratio: "16:9",
          n: 2,
          response_format: "url",
        }),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(1);
    expect(responseBody.data[0].url).toBe("https://cdn.minimax.io/generated/one.png");
    expect(responseBody.data[0].revised_prompt).toBe("A mountain");
  });

  it("falls back to 1:1 aspect ratio for unsupported pixel sizes", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { image_urls: ["https://cdn.minimax.io/two.png"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await handleImageGenerationCore({
      body: { prompt: "A forest", size: "1024x1024" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.aspect_ratio).toBe("1:1");
    expect(sentBody.model).toBe("image-01");
  });

  it("surfaces MiniMax upstream errors through the core error path", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response("login fail: invalid API key", { status: 401 })
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "bad-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  });

  // A 200 whose base_resp.status_code is 1026 ("Sensitive content detected in
  // prompt") is a per-request content rejection, NOT an account failure. The core
  // must surface it as 422 so the connection is never locked / cooled-down.
  it("returns 422 (not 502) when MiniMax content-filters a prompt (status_code 1026)", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { image_urls: [] },
          base_resp: { status_code: 1026, status_msg: "Sensitive content detected in prompt" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(422);
    expect(result.error).toContain("Sensitive content detected");
    expect(result.error).toContain("provider_request_rejected");
  });

  // A 200 with an empty image array and NO content-filter signal is a genuine
  // upstream failure and stays a 502.
  it("returns 502 when MiniMax returns 200 with an empty result and no filter signal", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { image_urls: [] }, base_resp: { status_code: 0, status_msg: "" } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });

  it("accepts the documented 21:9 ultrawide aspect ratio", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { image_urls: ["https://cdn.minimax.io/wide.png"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await handleImageGenerationCore({
      body: { prompt: "A panorama", size: "21:9" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.aspect_ratio).toBe("21:9");
  });

  it("maps OpenAI pixel sizes to the nearest MiniMax aspect ratio", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ data: { image_urls: ["https://cdn.minimax.io/tall.png"] } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await handleImageGenerationCore({
      body: { prompt: "A tower", size: "1024x1792" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.aspect_ratio).toBe("9:16");
  });

  it("honors the public response_format=b64_json seam, mapping to MiniMax base64 and normalizing to b64_json", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: { image_base64: ["aGVsbG8="] },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain", response_format: "b64_json" },
      modelInfo: { provider: "minimax", model: "image-01" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    const sentBody = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sentBody.response_format).toBe("base64");
    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("aGVsbG8=");
  });

  it("generates image with NanoBanana format", async () => {
    vi.useFakeTimers();
    global.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 200, data: { taskId: "task-123" } }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              successFlag: 1,
              response: { resultImageUrl: "https://example.com/nanobanana.png" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const pending = handleImageGenerationCore({
      body: { prompt: "A robot", n: 2, size: "1024x1792" },
      modelInfo: { provider: "nanobanana", model: "nanobanana-flash" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.type).toBe("TEXTTOIAMGE");
    expect(requestBody.numImages).toBe(2);
    expect(requestBody.image_size).toBe("9:16");
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.nanobananaapi.ai/api/v1/nanobanana/record-info?taskId=task-123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      })
    );

    const responseBody = await result.response.json();
    expect(responseBody.data[0].url).toBe("https://example.com/nanobanana.png");
  });

  it("generates image with SD WebUI format", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ images: ["base64sdwebui1", "base64sdwebui2"] }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A forest", size: "768x768", n: 2 },
      modelInfo: { provider: "sdwebui", model: "sdxl-base-1.0" },
      credentials: null,
      log: null,
    });

    expect(result.success).toBe(true);
    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.width).toBe(768);
    expect(requestBody.height).toBe(768);
    expect(requestBody.batch_size).toBe(2);

    const responseBody = await result.response.json();
    expect(responseBody.data).toHaveLength(2);
  });

  it("handles OpenRouter with HTTP-Referer header", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/or.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A city" },
      modelInfo: { provider: "openrouter", model: "openai/dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/images/generations",
      expect.objectContaining({
        headers: expect.objectContaining({
          "HTTP-Referer": "https://endpoint-proxy.local",
          "X-Title": "Endpoint Proxy",
        }),
      })
    );
  });

  it("handles Vercel AI Gateway image generation as OpenAI-compatible", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/vercel-image.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A watercolor castle", n: 1, size: "1024x1024" },
      modelInfo: { provider: "vercel-ai-gateway", model: "openai/gpt-image-1" },
      credentials: { apiKey: "vag-test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://ai-gateway.vercel.sh/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer vag-test-key",
        }),
        body: expect.stringContaining('"model":"openai/gpt-image-1"'),
      })
    );
  });

  it("handles HuggingFace binary response", async () => {
    const imageBuffer = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    global.fetch.mockResolvedValueOnce(
      new Response(imageBuffer, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A tree" },
      modelInfo: { provider: "huggingface", model: "black-forest-labs/FLUX.1-schnell" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(true);
    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBeTruthy();
  });

  it.each(["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])("generates an image through the Codex %s-image route", async (model) => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        [
          // Item completion alone is truncated; success requires response.completed.
          "event: response.output_item.done",
          'data: {"item":{"type":"image_generation_call","result":"base64codeximage"}}',
          "",
          "event: response.completed",
          'data: {"type":"response.completed","response":{"status":"completed"}}',
          "",
          "",
        ].join("\n"),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "A green square",
        size: "1024x1024",
        output_format: "png",
      },
      modelInfo: { provider: "codex", model: `${model}-image` },
      credentials: {
        accessToken: "codex-token",
        providerSpecificData: { chatgptAccountId: "account-123" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer codex-token",
          "chatgpt-account-id": "account-123",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.model).toBe(model);
    expect(requestBody.tools).toEqual([
      { type: "image_generation", output_format: "png", size: "1024x1024" },
    ]);

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64codeximage");
  });

  it("generates image with Cloudflare Workers AI JSON response", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { image: "base64cloudflare" },
          success: true,
          errors: [],
          messages: [],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A lighthouse", size: "1024x1536" },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/leonardo/lucid-origin" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/leonardo/lucid-origin",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer cf-token",
        }),
      })
    );

    const fetchCall = global.fetch.mock.calls[0];
    const requestBody = JSON.parse(fetchCall[1].body);
    expect(requestBody.prompt).toBe("A lighthouse");
    expect(requestBody.width).toBe(1024);
    expect(requestBody.height).toBe(1536);

    const responseBody = await result.response.json();
    expect(responseBody.data[0].b64_json).toBe("base64cloudflare");
  });

  it("uses multipart form data for Cloudflare FLUX.2 models", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          result: { image: "base64flux2" },
          success: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "A mountain lake", size: "1792x1024", steps: 4 },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/black-forest-labs/flux-2-klein-9b" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);

    const fetchCall = global.fetch.mock.calls[0];
    expect(fetchCall[1].headers).not.toHaveProperty("Content-Type");
    expect(fetchCall[1].body).toBeInstanceOf(FormData);
    expect(fetchCall[1].body.get("prompt")).toBe("A mountain lake");
    expect(fetchCall[1].body.get("width")).toBe("1792");
    expect(fetchCall[1].body.get("height")).toBe("1024");
    expect(fetchCall[1].body.get("steps")).toBe("4");
  });

  it("resolves Cloudflare img2img and inpainting URL inputs before sending", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200, headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ result: { image: "base64inpaint" }, success: true }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    const result = await handleImageGenerationCore({
      body: {
        prompt: "Change to a lion",
        image: "https://example.com/source.png",
        mask_image: "https://example.com/mask.png",
        size: "512x512",
      },
      modelInfo: { provider: "cloudflare-ai", model: "@cf/runwayml/stable-diffusion-v1-5-inpainting" },
      credentials: {
        apiKey: "cf-token",
        providerSpecificData: { accountId: "cf-account" },
      },
      log: null,
    });

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenNthCalledWith(1, "https://example.com/source.png");
    expect(global.fetch).toHaveBeenNthCalledWith(2, "https://example.com/mask.png");

    const providerCall = global.fetch.mock.calls[2];
    expect(providerCall[0]).toBe("https://api.cloudflare.com/client/v4/accounts/cf-account/ai/run/@cf/runwayml/stable-diffusion-v1-5-inpainting");
    const requestBody = JSON.parse(providerCall[1].body);
    expect(requestBody.image).toEqual([1, 2, 3]);
    expect(requestBody.image_b64).toBe(Buffer.from([1, 2, 3]).toString("base64"));
    expect(requestBody.mask).toEqual([4, 5, 6]);
    expect(requestBody.mask_image).toEqual([4, 5, 6]);
    expect(requestBody.mask_b64).toBe(Buffer.from([4, 5, 6]).toString("base64"));
  });

  it("handles provider error responses", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: "Rate limit exceeded" } }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      )
    );

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toContain("Rate limit exceeded");
  });

  it("handles network errors", async () => {
    global.fetch.mockRejectedValueOnce(new Error("Network timeout"));

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("Network timeout");
  });

  it("calls onRequestSuccess callback on success", async () => {
    global.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          created: 1234567890,
          data: [{ url: "https://example.com/success.png" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const onRequestSuccess = vi.fn();

    const result = await handleImageGenerationCore({
      body: { prompt: "test" },
      modelInfo: { provider: "openai", model: "dall-e-3" },
      credentials: { apiKey: "test-key" },
      log: null,
      onRequestSuccess,
    });

    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("image and embedding handler usage accounting", () => {
  let writes;
  let handlers;
  let auth;
  let pricing;

  beforeEach(async () => {
    vi.resetModules();
    writes = vi.fn(async () => true);
    pricing = vi.fn(async () => ({ input: 2, output: 0 }));
    auth = {
      resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "key-id" } })),
      getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({ connectionId: "account-1", apiKey: "provider-key" })),
      getNoAuthProviderCredentials: vi.fn(async () => ({})),
      markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
      clearAccountError: vi.fn(),
      extractApiKey: vi.fn(() => "caller-key"),
      hasValidCliToken: vi.fn(() => false),
    };
    vi.doMock("@/lib/localDb", () => ({
      getSettings: vi.fn(async () => ({})), getApiKeyByKey: vi.fn(async () => null),
      getApiKeyById: vi.fn(async () => null), getApiKeyUsageTotals: vi.fn(async () => ({})),
      getApiKeyUsageLimitStatus: vi.fn(async () => ({ exceeded: false })),
      getComboForModel: vi.fn(async () => null), getPricingForModel: pricing,
      saveRequestUsage: writes,
    }));
    vi.doMock("../../src/sse/services/auth.js", () => auth);
    vi.doMock("../../src/sse/services/model.js", () => ({
      getModelInfo: vi.fn(async (id) => { const [provider, ...model] = id.split("/"); return { provider, model: model.join("/") }; }),
      getComboModels: vi.fn(async () => null), getComboCanonicalName: vi.fn(async () => null),
    }));
    vi.doMock("../../src/sse/services/tokenRefresh.js", () => ({
      checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials), updateProviderCredentials: vi.fn(),
    }));
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => global.fetch(...args) }));
    handlers = {
      image: (await import("../../src/sse/handlers/imageGeneration.js")).handleImageGeneration,
      edit: (await import("../../src/sse/handlers/imageEdit.js")).handleImageEdit,
      embedding: (await import("../../src/sse/handlers/embeddings.js")).handleEmbeddings,
    };
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const module of ["@/lib/localDb", "../../src/sse/services/auth.js", "../../src/sse/services/model.js", "../../src/sse/services/tokenRefresh.js", "../../open-sse/utils/proxyFetch.js"]) vi.doUnmock(module);
    vi.resetModules();
  });

  function request(kind, query = "") {
    const endpoint = kind === "embedding" ? "/v1/embeddings" : kind === "edit" ? "/v1/images/edits" : "/v1/images/generations";
    if (kind === "edit") {
      const body = new FormData();
      body.set("model", "openai/gpt-image-1"); body.set("prompt", "cat");
      body.set("image", new Blob(["image"]), "image.png");
      return new Request(`http://localhost${endpoint}${query}`, { method: "POST", body });
    }
    return new Request(`http://localhost${endpoint}${query}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(kind === "embedding" ? { model: "openai/text-embedding-3-small", input: "not a token count" } : { model: "openai/gpt-image-1", prompt: "cat", n: 8 }) });
  }

  it.each(["image", "edit"])("%s counts returned images without inventing token spend or free cost", async (kind) => {
    global.fetch.mockResolvedValue(Response.json({ created: 1, data: [{ b64_json: "Y2F0" }, { url: "https://example.com/cat" }] }));
    const response = await handlers[kind](request(kind));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toHaveLength(2);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ apiKey: "caller-key", connectionId: "account-1", provider: "openai",
      tokens: {}, nativeUnits: { images: 2 }, cost: null, costStatus: "unknown", costSource: "unavailable", modality: "image",
      usageEventId: JSON.stringify([response.headers.get("x-request-id"), kind === "edit" ? "image-edit" : "image-generation", "openai", "gpt-image-1", "account-1"]) });
  });

  it.each(["image", "edit", "embedding"])("%s preserves an authoritative zero-cost receipt", async (kind) => {
    const usage = { prompt_tokens: 0, total_tokens: 0, cost_usd: 0 };
    global.fetch.mockResolvedValue(Response.json({ created: 1, data: [{ b64_json: "Y2F0", embedding: [0.1] }], usage }));
    expect((await handlers[kind](request(kind))).status).toBe(200);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({
      apiKey: "caller-key", connectionId: "account-1", cost: 0, costStatus: "known", costSource: "provider",
      tokens: { prompt_tokens: 0, input_tokens: 0, total_tokens: 0 },
      meta: { providerUsage: { path: "usage", value: usage }, providerCost: { path: "usage.cost_usd", value: 0 } },
    });
    expect(pricing).not.toHaveBeenCalled();
  });

  it("returns binary bytes without reading them for accounting", async () => {
    global.fetch.mockResolvedValue(Response.json({ created: 1, data: [{ b64_json: "Y2F0" }] }));
    const response = await handlers.image(request("image", "?response_format=binary"));
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(await response.text()).toBe("cat");
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ tokens: {}, nativeUnits: { images: 1 }, cost: null, costStatus: "unknown" });
  });

  it("preserves reported embedding input tokens without inventing a price", async () => {
    global.fetch.mockResolvedValue(Response.json({ data: [{ embedding: [0.1] }], usage: { prompt_tokens: 1000, total_tokens: 1000 } }));
    const response = await handlers.embedding(request("embedding"));
    expect(response.status).toBe(200);
    expect((await response.json()).usage.prompt_tokens).toBe(1000);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ endpoint: "/v1/embeddings", modality: "embedding", cost: null,
      costStatus: "unknown", costSource: "unavailable", tokens: { prompt_tokens: 1000, input_tokens: 1000, total_tokens: 1000 },
      meta: { providerUsage: { path: "usage", value: { prompt_tokens: 1000, total_tokens: 1000 } } } });
    expect(pricing).not.toHaveBeenCalled();
  });

  it("keeps missing embedding usage unknown", async () => {
    global.fetch.mockResolvedValue(Response.json({ data: [{ embedding: [0.1] }] }));
    expect((await handlers.embedding(request("embedding"))).status).toBe(200);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ tokens: {}, cost: null, costStatus: "unknown" });
    expect(pricing).not.toHaveBeenCalled();
  });

  it.each(["image", "edit", "embedding"])("%s does not spend allowance on an upstream failure", async (kind) => {
    global.fetch.mockResolvedValue(Response.json({ error: { message: "Unavailable" } }, { status: 503 }));
    expect((await handlers[kind](request(kind))).status).toBe(503);
    expect(writes).not.toHaveBeenCalled();
  });

  it("charges only the winning account after retry", async () => {
    auth.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    auth.getProviderCredentialsWithQuotaPreflight.mockResolvedValueOnce({ connectionId: "failed", apiKey: "bad" })
      .mockResolvedValueOnce({ connectionId: "winner", apiKey: "good" });
    global.fetch.mockResolvedValueOnce(Response.json({ error: { message: "Unavailable" } }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ created: 1, data: [{ b64_json: "Y2F0" }] }));
    expect((await handlers.image(request("image"))).status).toBe(200);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ connectionId: "winner", nativeUnits: { images: 1 } });
  });

  function codexRequest() {
    return new Request("http://localhost/v1/images/generations", { method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "codex/gpt-image-1", prompt: "cat", n: 8 }) });
  }

  const codexItem = 'event: response.output_item.done\ndata: {"item":{"type":"image_generation_call","result":"Y2F0"}}\n\n';
  const codexDone = 'event: response.completed\ndata: {"response":{"status":"completed","usage":{"input_tokens":3,"cost_usd":0}}}\n\n';

  it("commits once after real Codex completion and awaits persistence before done", async () => {
    let entered;
    let release;
    const writing = new Promise((resolve) => { entered = resolve; });
    const persisted = new Promise((resolve) => { release = resolve; });
    writes.mockImplementation(async () => { entered(); await persisted; return true; });
    global.fetch.mockResolvedValue(new Response(codexItem + codexDone + codexDone));
    const response = await handlers.image(codexRequest());
    expect(writes).not.toHaveBeenCalled();
    expect(auth.clearAccountError).not.toHaveBeenCalled();
    let delivered = false;
    const text = response.text().then((value) => { delivered = true; return value; });
    await writing;
    expect(delivered).toBe(false);
    expect(writes).toHaveBeenCalledOnce();
    expect(writes.mock.calls[0][0]).toMatchObject({
      nativeUnits: { images: 1 }, tokens: { input_tokens: 3 }, cost: 0, costStatus: "known",
      meta: { providerUsage: { path: "response.usage", value: { input_tokens: 3, cost_usd: 0 } } },
      usageEventId: JSON.stringify([response.headers.get("x-request-id"), "image-generation", "codex", "gpt-image-1", "account-1"]),
    });
    release();
    expect(await text).toContain('event: done\ndata: {"created":');
    expect(await text).toContain('"b64_json":"Y2F0"');
    expect(writes).toHaveBeenCalledOnce();
    expect(auth.clearAccountError).toHaveBeenCalledOnce();
  });

  it.each([
    codexItem,
    codexItem + 'event: response.failed\ndata: {"response":{"error":{"message":"failed"}}}\n\n',
    codexItem + 'event: response.incomplete\ndata: {"response":{}}\n\n',
  ])("does not spend allowance after a failed real Codex stream", async (upstream) => {
    global.fetch.mockResolvedValue(new Response(upstream));
    const response = await handlers.image(codexRequest());
    expect(await response.text()).toContain("event: error");
    expect(writes).not.toHaveBeenCalled();
    expect(auth.clearAccountError).not.toHaveBeenCalled();
  });

  it("does not read ahead or spend allowance when client cancels before completion", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    global.fetch.mockResolvedValue(new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 })));
    const response = await handlers.image(codexRequest());
    expect(pull).not.toHaveBeenCalled();
    await response.body.cancel("disconnected");
    expect(cancel).toHaveBeenCalledOnce();
    expect(writes).not.toHaveBeenCalled();
    expect(auth.clearAccountError).not.toHaveBeenCalled();
  });

  it("keeps reported embedding usage unpriced when no canonical rate exists", async () => {
    pricing.mockResolvedValue(null);
    global.fetch.mockResolvedValue(Response.json({ data: [], usage: { prompt_tokens: 9, total_tokens: 9 } }));
    expect((await handlers.embedding(request("embedding"))).status).toBe(200);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ tokens: { prompt_tokens: 9 }, cost: null, costStatus: "unknown" });
  });

  it.each([
    { prompt_tokens: 9 },
    { prompt_tokens: 9, total_tokens: 9, prompt_tokens_details: { cached_tokens: 4 } },
  ])("does not price incomplete or unsupported embedding units: %j", async (usage) => {
    global.fetch.mockResolvedValue(Response.json({ data: [], usage }));
    expect((await handlers.embedding(request("embedding"))).status).toBe(200);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ cost: null, costStatus: "unknown" });
    expect(pricing).not.toHaveBeenCalled();
  });

  it.each(["not-json", "null"])("preserves successful image edit passthrough without usable JSON: %s", async (text) => {
    global.fetch.mockResolvedValue(new Response(text, { headers: { "content-type": "application/json" } }));
    const response = await handlers.edit(request("edit"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(text);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0]).toMatchObject({ tokens: {}, nativeUnits: {}, cost: null });
  });
});
