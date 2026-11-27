import { describe, it, expect } from "vitest";
import * as entry from "../../open-sse/executors/chatgpt-web-http.js";
import { readFileSync, readdirSync } from "node:fs";
describe("ChatGPT Web HTTP module boundaries", () => {
 it("preserves the public exports", () => { expect(Object.keys(entry).sort()).toEqual(["ChatGptWebHttpExecutor", "__buildImageDownloadHeadersForTesting", "__derivePublicBaseUrlForTesting", "__resetChatGptWebCachesForTesting", "__waitForImageViaWebSocketForTesting", "detectImageResolutionFailure"]); });
 it("keeps focused modules under 800 lines", () => {
 const dir = new URL("../../open-sse/executors/chatgpt-web/", import.meta.url);
 for (const file of readdirSync(dir).filter(name => name.endsWith(".js"))) {
 expect(readFileSync(new URL(file, dir), "utf8").split("\n").length, file).toBeLessThanOrEqual(800);
 }
 });
});
