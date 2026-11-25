import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

// Real loopback socket: a stubbed fetch cannot see how the body is serialized.
describe("upstream 9router #5528: STT uploads leave as multipart/form-data", () => {
  let server;
  let origin;
  const requests = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({ contentType: req.headers["content-type"] || "", body: Buffer.concat(chunks).toString("latin1") });
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ text: "ok" }));
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  // One row per multipart builder: OpenAI-compatible, NVIDIA and native speech.
  it.each(["openai", "nvidia-asr", "xai-stt", "cohere-stt"])("%s keeps the file and fields", async (format) => {
    requests.length = 0;
    const form = new FormData();
    form.set("file", new File([Buffer.from("fake wav bytes")], "clip.wav", { type: "audio/wav" }));
    form.set("language", "en");

    const result = await handleSttCore({
      provider: "loopback-stt",
      model: "test-model",
      formData: form,
      credentials: { apiKey: "test-key" },
      sttConfig: { baseUrl: `${origin}/v1/audio/transcriptions`, authType: "apikey", authHeader: "bearer", format, models: [{ id: "test-model" }] },
    });

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(requests[0].body).toContain('name="file"; filename="clip.wav"');
    expect(requests[0].body).toContain("fake wav bytes");
  });
});
