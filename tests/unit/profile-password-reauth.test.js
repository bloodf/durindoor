import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const pagePath = new URL("../../src/app/(dashboard)/dashboard/profile/page.js", import.meta.url);

describe("profile password change contract", () => {
  it("submits current password and redirects to login when replacement cookie issuance requires reauthentication", async () => {
    const page = await readFile(pagePath, "utf8");
    expect(page).toContain('currentPassword: passwords.current');
    expect(page).toContain('if (res.ok && data?.reauthenticate)');
    expect(page).toContain('window.location.assign("/login")');
  });

  it("keeps a visible current-password field in the protected password form", async () => {
    const page = await readFile(pagePath, "utf8");
    expect(page).toMatch(/<label[^>]*htmlFor="profile-current-password"[^>]*>Current Password<\/label>\s*<Input\s+id="profile-current-password"\s+type="password"/);
  });

  it("associates each password label with a unique stable input id", async () => {
    const page = await readFile(pagePath, "utf8");
    for (const id of ["profile-current-password", "profile-new-password", "profile-confirm-password"]) {
      expect(page).toContain(`htmlFor="${id}"`);
      expect(page).toContain(`id="${id}"`);
    }
  });
});
