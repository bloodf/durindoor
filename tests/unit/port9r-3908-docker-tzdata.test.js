import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOCKERFILE = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8");

describe("9router #3908 (e9a459ebece0) - TZ support in the image", () => {
  it("installs tzdata in the runtime stage", () => {
    const runtimeStage = DOCKERFILE.slice(DOCKERFILE.lastIndexOf("\nFROM "));

    expect(runtimeStage).toMatch(/apk add --no-cache[^&\n]*\btzdata\b/);
  });
});
