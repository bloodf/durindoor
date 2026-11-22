// Port of decolua/9router#4866: CODEX_IMAGE_RESPONSES_MODEL selects the Responses
// model that drives Codex hosted image tools; the image tool model is unchanged.
import { afterEach, describe, expect, it, vi } from "vitest";
import codex from "../../open-sse/handlers/imageProviders/codex.js";

afterEach(() => vi.unstubAllEnvs());

const build = () => codex.buildBody("gpt-image-2.5", { prompt: "Draw a square" }, { streamToClient: true });

describe("Codex image Responses model override (#4866)", () => {
  it("defaults to gpt-6-sol", () => {
    vi.stubEnv("CODEX_IMAGE_RESPONSES_MODEL", "");
    expect(build().model).toBe("gpt-6-sol");
  });

  it("uses the trimmed override and keeps the image tool model", () => {
    vi.stubEnv("CODEX_IMAGE_RESPONSES_MODEL", "  gpt-6-astra  ");
    const body = build();
    expect(body.model).toBe("gpt-6-astra");
    expect(body.tools[0]).toMatchObject({ model: "gpt-image-2.5", action: "generate" });
  });

  it("falls back to terra when the configured main model is rejected", () => {
    vi.stubEnv("CODEX_IMAGE_RESPONSES_MODEL", "gpt-6-astra");
    const original = build();
    expect(codex.buildFallbackBody(original, 400, "The 'gpt-6-astra' model is not supported when using Codex"))
      .toEqual({ ...original, model: "gpt-5.6-terra" });
  });

  it("does not loop when terra itself is the configured model", () => {
    vi.stubEnv("CODEX_IMAGE_RESPONSES_MODEL", "gpt-5.6-terra");
    expect(codex.buildFallbackBody(build(), 400, "model is not supported when using Codex")).toBeNull();
  });
});
