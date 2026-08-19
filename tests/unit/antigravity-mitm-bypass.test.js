import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const serverPath = path.resolve(process.cwd(), "../src/mitm/server.js");
const source = fs.readFileSync(serverPath, "utf8");

describe("Antigravity MITM routing", () => {
  it("dispatches the full override to the Antigravity interceptor", () => {
    expect(source).toContain('requestHandlers[tool].intercept(req, res, bodyBuffer, mappedOverride, passthroughRequest)');
    // The dispatcher calls the injected `passthroughRequest`, so the bypass this
    // guards against would read `passthroughRequest`, not the module-level
    // `passthrough`. Matching the old name could never fire.
    expect(source).not.toContain('if (tool === "antigravity") {\n      return passthroughRequest(req, res, bodyBuffer);');
  });
});
