import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const serverPath = path.resolve(process.cwd(), "../src/mitm/server.js");
const source = fs.readFileSync(serverPath, "utf8");

describe("Antigravity MITM routing", () => {
  it("dispatches the full override to the Antigravity interceptor", () => {
    expect(source).toContain('handlers[tool].intercept(req, res, bodyBuffer, mappedOverride, passthrough)');
    expect(source).not.toContain('if (tool === "antigravity") {\n      return passthrough(req, res, bodyBuffer);');
  });
});
