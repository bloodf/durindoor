import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// These exclusions prevent host dependencies and local credentials entering the build context.
describe("Docker build context", () => {
  const entries = readFileSync(new URL("../../.dockerignore", import.meta.url), "utf8").split(/\r?\n/);
  it("excludes nested dependencies and local secrets while keeping the example environment", () => {
    for (const pattern of ["**/node_modules", ".env*", "!.env.example", "*.pem"]) {
      expect(entries).toContain(pattern);
    }
  });
});
