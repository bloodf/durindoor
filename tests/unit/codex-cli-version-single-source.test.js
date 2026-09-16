import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { CODEX_CLI_VERSION, CODEX_CLI_USER_AGENT } from "../../open-sse/config/appConstants.js";

// Codex identity headers drifted once already: the registry transport advertised one
// CLI version while the image, usage, quota and connection-test paths each carried
// their own hardcoded copy, so a bump left OpenAI's backend seeing a mismatched
// `Version` / `User-Agent` pair. These assert the single source actually reaches the
// wire, and that no second copy creeps back in.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("codex CLI version single-sourcing", () => {
  it("derives the exported version and user-agent from the registry transport", () => {
    expect(CODEX_CLI_VERSION).toBe(PROVIDERS.codex.cliVersion);
    expect(CODEX_CLI_USER_AGENT).toBe(`codex_cli_rs/${CODEX_CLI_VERSION}`);
  });

  it("advertises one version across the transport header and the usage client_version", () => {
    expect(PROVIDERS.codex.headers["User-Agent"]).toBe(`codex_cli_rs/${CODEX_CLI_VERSION}`);
    expect(PROVIDERS.codex.usage.clientVersion).toBe(CODEX_CLI_VERSION);
  });

  it("keeps no second hardcoded codex_cli_rs version in the request paths", () => {
    for (const rel of [
      "../../open-sse/handlers/imageProviders/codex.js",
      "../../open-sse/services/usage/codex.js",
      "../../open-sse/services/quota/providers/codex.js",
      "../../src/app/api/providers/[id]/test/testUtils.js",
    ]) {
      expect(read(rel)).not.toMatch(/codex_cli_rs\/\d+\.\d+\.\d+/);
    }
  });
});
