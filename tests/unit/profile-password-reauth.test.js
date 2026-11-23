import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

const pagePath = new URL("../../src/app/(dashboard)/dashboard/profile/page.js", import.meta.url);

describe("profile password change contract", () => {
  it("submits current password and redirects to login when replacement cookie issuance requires reauthentication", async () => {
    const page = await readFile(pagePath, "utf8");
    expect(page).toContain('currentPassword: passwords.current');
    expect(page).toContain('if (res.ok && data?.reauthenticate)');
    // #1810 prefixes the login redirect with NEXT_PUBLIC_BASE_PATH ("" at root).
    expect(page).toMatch(/if \(res\.ok && data\?\.reauthenticate\) \{\s*window\.location\.assign\(\(process\.env\.NEXT_PUBLIC_BASE_PATH \|\| ""\) \+ "\/login"\);\s*return;/);
  });

  it("keeps a visible current-password field in the protected password form", async () => {
    const page = await readFile(pagePath, "utf8");
    expect(page).toContain('<Input id="profile-current-password" label="Current password" type="password"');
  });

  it("passes unique stable input ids and labels to each password field", async () => {
    const page = await readFile(pagePath, "utf8");
    for (const [id, label] of [
      ["profile-current-password", "Current password"],
      ["profile-new-password", "New password"],
      ["profile-confirm-password", "Confirm password"],
    ]) {
      expect(page).toContain(`<Input id="${id}" label="${label}" type="password"`);
    }
  });
});
