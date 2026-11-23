import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

const { initTranslators } = vi.hoisted(() => ({ initTranslators: vi.fn() }));
vi.mock("open-sse/translator/index.js", async (importOriginal) => ({
  ...await importOriginal(),
  initTranslators,
}));

import { handleChat } from "@/sse/handlers/chat.js";

const routeFiles = [
  "src/app/api/v1/chat/completions/route.js",
  "src/app/api/v1/messages/route.js",
  "src/app/api/v1/responses/route.js",
  "src/app/api/v1/responses/compact/route.js",
  "src/app/api/v1/completions/route.js",
  "src/app/api/v1/api/chat/route.js",
  "src/app/api/v1beta/models/[...path]/route.js",
];

describe("review r-translator-init", () => {
  it("routes through the shared handler without route-level initialization", async () => {
    for (const path of routeFiles) {
      const source = await readFile(new URL(`../../${path}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/initTranslators|ensureInitialized|let initialized\s*=/);
    }

    await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }));
    await handleChat(new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    }));

    expect(initTranslators).toHaveBeenCalledTimes(1);
  });
});
