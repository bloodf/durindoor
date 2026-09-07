import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pagePath = new URL("../../src/app/login/page.js", import.meta.url);
const loginViewPath = new URL("../../src/app/login/LoginView.js", import.meta.url);

describe("login page default-password hint", () => {
  it("does not embed the built-in default credential", async () => {
    const [page, loginView] = await Promise.all([readFile(pagePath, "utf8"), readFile(loginViewPath, "utf8")]);
    expect(`${page}\n${loginView}`).not.toContain("123" + "456");
    expect(loginView).toContain("configured default password must be changed");
  });
});
