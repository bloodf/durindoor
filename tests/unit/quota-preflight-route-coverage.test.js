import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const handlersDir = join(here, "../../src/sse/handlers");

// OmniRoute PR #6742 regression guard (its "issue-6686 quota preflight
// coverage" test): every credentialed route that must route account selection
// through the live quota preflight has to import AND call the wrapper, and
// must not fall back to the bare selector. Best-effort single-attempt routes
// (count_tokens, Gemini-native v1beta) intentionally keep the plain selector.
const QUOTA_PREFLIGHT_ROUTES = [
  "chat.js",
  "embeddings.js",
  "fetch.js",
  "imageEdit.js",
  "imageGeneration.js",
  "moderations.js",
  "music.js",
  "rerank.js",
  "search.js",
  "stt.js",
  "tts.js",
  "video.js",
];

describe("quota preflight route coverage (OmniRoute #6742)", () => {
  for (const file of QUOTA_PREFLIGHT_ROUTES) {
    it(`${file} selects credentials through getProviderCredentialsWithQuotaPreflight only`, () => {
      const source = readFileSync(join(handlersDir, file), "utf8");
      expect(source, `${file} must call the quota-preflight wrapper`).toMatch(
        /getProviderCredentialsWithQuotaPreflight\s*\(/
      );
      // No bare-selector call survives (word boundary + not the wrapper name).
      expect(source, `${file} must not call the plain getProviderCredentials`).not.toMatch(
        /getProviderCredentials(?!WithQuotaPreflight)\s*\(/
      );
    });
  }
});
