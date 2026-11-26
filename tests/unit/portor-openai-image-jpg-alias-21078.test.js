import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const generate = (provider, body) => handleImageGenerationCore({
  body: { prompt: "A bird", ...body },
  modelInfo: { provider, model: "gpt-image-2" },
  credentials: { apiKey: "fixture-key" },
});

describe("OmniRoute #21078 — OpenAI JPG output alias", () => {
  const fetchMock = vi.fn();
  const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body);

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => Response.json({ data: [{ b64_json: jpeg }] }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([["jpg", undefined], [" JpG ", 0], ["JPG", 80]])("sends %j as jpeg", async (format, compression) => {
    const input = { output_format: format, output_compression: compression };
    const result = await generate("openai", input);

    expect(result.success).toBe(true);
    expect(sentBody().output_format).toBe("jpeg");
    expect(sentBody().output_compression).toBe(compression);
    expect(input.output_format).toBe(format);
  });

  it("does not rewrite the alias for another OpenAI-compatible provider", async () => {
    const result = await generate("openrouter", { output_format: "jpg" });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
