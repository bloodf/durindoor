import { afterEach, describe, expect, it, vi } from "vitest";
import { handleBypassRequest } from "../../open-sse/utils/bypassHandler.js";

const ua = "claude-cli/2.1";
const prefix = { stream: false, messages: [{ role: "user", content: "<policy_spec>rules</policy_spec>\nCommand: git status --short" }] };
const suggestion = { stream: false, messages: [{ role: "user", content: "[SUGGESTION MODE: suggest next input]" }] };
const paths = { stream: false, system: "Extract <filepaths>", messages: [{ role: "user", content: "Command: cat src/main.js\nOutput: content" }] };
const answer = async (body) => {
  const result = await handleBypassRequest(body, "model", ua).response.json();
  return result.choices?.[0].message.content ?? result.content?.map((block) => block.text).join("");
};

afterEach(() => vi.unstubAllEnvs());

describe("OmniRoute 26e95d97bd58 Claude Code helper replies", () => {
  it("forwards all helpers by default and isolates their flags", () => {
    for (const body of [prefix, suggestion, paths]) expect(handleBypassRequest(body, "model", ua)).toBeNull();
    vi.stubEnv("CLAUDE_CODE_LOCAL_FILEPATHS_ENABLED", "true");
    expect(handleBypassRequest(prefix, "model", ua)).toBeNull();
    expect(handleBypassRequest(suggestion, "model", ua)).toBeNull();
  });

  it("returns the command prefix, empty suggestion and file paths when enabled", async () => {
    vi.stubEnv("CLAUDE_CODE_LOCAL_COMMAND_PREFIX_ENABLED", "true");
    vi.stubEnv("CLAUDE_CODE_LOCAL_SUGGESTION_ENABLED", "true");
    vi.stubEnv("CLAUDE_CODE_LOCAL_FILEPATHS_ENABLED", "true");
    expect(await answer(prefix)).toBe("git status");
    expect(await answer(suggestion)).toBe("");
    expect(await answer(paths)).toBe("<filepaths>\nsrc/main.js\n</filepaths>");
    expect(handleBypassRequest(prefix, "model", "curl")).toBeNull();
    expect(handleBypassRequest({ ...prefix, tools: [{ name: "bash" }] }, "model", ua)).toBeNull();
    expect(handleBypassRequest({ ...paths, messages: [{ role: "user", content: "Command: cat a; rm b\nOutput: x" }] }, "model", ua)).toBeNull();
    expect(handleBypassRequest({ stream: false, messages: [{ role: "user", content: "Please inspect this code" }] }, "model", ua)).toBeNull();
  });
});
