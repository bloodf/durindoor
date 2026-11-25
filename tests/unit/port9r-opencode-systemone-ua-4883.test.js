// Port of decolua/9router#4883: every OpenCode request, System One included,
// identifies with the 2.0 channel-form User-Agent.
import { describe, expect, it } from "vitest";
import { OPENCODE_UA } from "../../open-sse/executors/opencode.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

describe("port decolua/9router#4883 - OpenCode System One fingerprint", () => {
  it.each(["opencode", "opencode-zen"])("%s sends the executor's channel-form User-Agent", (id) => {
    expect(PROVIDER_MEDIA[id].systemoneConfig.headers["User-Agent"]).toBe(OPENCODE_UA);
  });
});
