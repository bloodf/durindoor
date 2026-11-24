import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import openai from "../../open-sse/providers/registry/openai.js";
import anthropic from "../../open-sse/providers/registry/anthropic.js";
import openrouter from "../../open-sse/providers/registry/openrouter.js";
import kilocode from "../../open-sse/providers/registry/kilocode.js";
import { getComboModelsFromData } from "../../open-sse/services/combo.js";

const require = createRequire(import.meta.url);
const { PROVIDER_MODELS } = require("../../cli/src/cli/menus/providers.js").__test__;
const ids = (provider) => provider.models.map((model) => model.id);

describe("retired direct provider catalog entries", () => {
  it("omits documented retired direct IDs and snapshots", () => {
    for (const id of ["gpt-4-turbo", "gpt-4-turbo-2024-04-09", "gpt-4.1-nano", "gpt-4.1-nano-2025-04-14", "o3-mini", "o3-mini-2025-01-31", "o4-mini", "o4-mini-2025-04-16", "o1-mini", "gpt-image-1", "dall-e-2", "dall-e-3"]) expect(ids(openai)).not.toContain(id);
    for (const id of ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-3-5-sonnet-20241022"]) expect(ids(anthropic)).not.toContain(id);
  });

  it("retains independent provider routes, replacements and saved combo members", () => {
    expect(ids(openrouter)).toContain("openai/gpt-image-1");
    expect(ids(kilocode)).toContain("anthropic/claude-sonnet-4-20250514");
    expect(ids(openai)).toEqual(expect.arrayContaining(["gpt-5.6-sol", "gpt-image-2.5-sunburst", "gpt-image-1-mini"]));
    expect(ids(anthropic)).toEqual(expect.arrayContaining(["claude-sonnet-5-5", "claude-opus-4-8", "claude-sonnet-4-5"]));
    expect(getComboModelsFromData("saved", [{ name: "saved", models: ["openai/gpt-image-1"] }])).toEqual(["openai/gpt-image-1"]);
  });

  it("refreshes CLI direct choices without removing other providers", () => {
    expect(PROVIDER_MODELS.anthropic.map((m) => m.id)).toEqual(["claude-sonnet-5-5", "claude-opus-4-8"]);
    for (const id of ["gpt-4-turbo", "o1-mini"]) expect(PROVIDER_MODELS.openai.map((m) => m.id)).not.toContain(id);
    expect(PROVIDER_MODELS.openrouter.map((m) => m.id)).toContain("auto");
  });
});
