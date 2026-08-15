import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pagePath = new URL("../../src/app/login/page.js", import.meta.url);

describe("login page default-password hint", () => {
  it("does not embed the built-in default credential", async () => {
    const page = await readFile(pagePath, "utf8");
    expect(page).not.toContain("123" + "456");
    expect(page).toContain("configured default password must be changed");
  });
});
