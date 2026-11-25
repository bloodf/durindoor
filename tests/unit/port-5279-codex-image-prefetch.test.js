import { afterEach, describe, expect, it, vi } from "vitest";
import { CodexExecutor } from "../../open-sse/executors/codex.js";
import * as imageConcern from "../../open-sse/translator/concerns/image.js";

vi.mock("../../open-sse/translator/concerns/image.js", async (importOriginal) => ({
  ...await importOriginal(),
  fetchImageAsBase64: vi.fn(),
}));

describe("upstream PR #5279 - native input_image prefetch", () => {
  afterEach(() => vi.mocked(imageConcern.fetchImageAsBase64).mockReset());

  it("inlines a remote input_image and keeps its other fields", async () => {
    vi.mocked(imageConcern.fetchImageAsBase64).mockResolvedValue({ url: "data:image/png;base64,AA==" });
    const body = { input: [{ role: "user", content: [
      { type: "input_image", image_url: "https://images.invalid/a.png", detail: "high" },
      { type: "input_image", image_url: "data:image/png;base64,BB==" },
      { type: "input_image", file_id: "file-1" },
    ] }] };
    await new CodexExecutor().prefetchImages(body);
    expect(body.input[0].content).toEqual([
      { type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" },
      { type: "input_image", image_url: "data:image/png;base64,BB==" },
      { type: "input_image", file_id: "file-1" },
    ]);
    expect(imageConcern.fetchImageAsBase64).toHaveBeenCalledTimes(1);
  });
});
