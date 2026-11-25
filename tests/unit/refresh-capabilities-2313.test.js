// #2313: rotation lanes, Google anti-burst spacing and project-ID discovery
// moved from three separate lists into one table. Pin the membership so the
// move stays behaviour-preserving.
import { describe, expect, it } from "vitest";
import { refreshCapabilities } from "../../open-sse/services/tokenRefresh/capabilities.js";
import { rotationGroupFor } from "../../open-sse/services/refreshSerializer.js";

const GOOGLE = ["antigravity", "agy", "gemini-cli"];
const LANES = {
  codex: "openai-auth0",
  openai: "openai-auth0",
  claude: "anthropic-oauth",
  "gitlab-duo": "gitlab-duo",
  kiro: "kiro",
  "amazon-q": "kiro",
  "kimi-coding": "kimi-coding",
  "kimi-ai": "kimi-ai",
  qwen: "qwen"
};

describe("refresh capability table", () => {
  it("keeps the rotation lanes the serializer used before", () => {
    for (const [provider, group] of Object.entries(LANES)) {
      expect(rotationGroupFor(provider)).toBe(group);
    }
    for (const provider of [...GOOGLE, "github", "cursor", "unknown"]) {
      expect(rotationGroupFor(provider)).toBeNull();
    }
  });

  it("marks exactly the Google Cloud providers for spacing and project IDs", () => {
    for (const provider of GOOGLE) {
      expect(refreshCapabilities(provider)).toMatchObject({ googleAntiBurst: true, googleProjectId: true });
    }
    for (const provider of [...Object.keys(LANES), "github", "gemini", "unknown"]) {
      expect(refreshCapabilities(provider).googleAntiBurst).toBeUndefined();
      expect(refreshCapabilities(provider).googleProjectId).toBeUndefined();
    }
  });

  it("does not resolve inherited object keys as providers", () => {
    expect(refreshCapabilities("toString")).toEqual({});
    expect(rotationGroupFor("__proto__")).toBeNull();
  });
});
