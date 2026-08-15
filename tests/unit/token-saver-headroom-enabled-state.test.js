import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clientPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js"
);

describe("Token Saver Headroom enabled setting", () => {
  it("keeps saved enabled intent selectable while status reports an unavailable proxy", () => {
    const source = fs.readFileSync(clientPath, "utf8");

    expect(source).toContain('fetch("/api/settings"');
    expect(source).toContain('fetch("/api/headroom/status"');
    expect(source).toMatch(/checked=\{headroomEnabled\}/);
    expect(source).not.toMatch(/checked=\{headroomEnabled\s*&&\s*headroomRunning\}/);
    expect(source).not.toMatch(/disabled=\{!headroomRunning\}/);
    expect(source).toContain('{headroomStatusLabel}');
  });
});
