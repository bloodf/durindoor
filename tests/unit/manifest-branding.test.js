import { describe, expect, it } from "vitest";

import manifest from "../../src/app/manifest.js";

describe("app manifest branding", () => {
  it("uses DurinDoor copy and branded icon paths", () => {
    const appManifest = manifest();

    expect(appManifest.name).toBe("DurinDoor - AI Gateway");
    expect(appManifest.short_name).toBe("DurinDoor");
    expect(appManifest.description).toBe(
      "One stable API in front of many upstream AI providers. Self-hosted OpenAI-compatible gateway.",
    );
    expect(appManifest.icons).toEqual([
      {
        src: "/icons/icon-192.svg",
        sizes: "192x192",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-512.svg",
        sizes: "512x512",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ]);
  });
});
