import { test, expect } from "./fixtures.js";

// Real browser keyboard events exercise native dialog defaults. Synthetic story
// key events cannot prove Escape, background inertness, or focus return.
test("endpoint dialog contains keyboard focus and restores its opener", async ({ page, qa }) => {
  await qa.seed("empty");
  await qa.authenticate(page);
  await page.goto(`${qa.baseURL}/dashboard/endpoint`);
  const opener = page.getByRole("button", { name: "Create Key", exact: true }).first();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Create API Key", exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const controls = await dialog.locator("button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex='0']").count();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let step = 0; step < controls + 2; step += 1) {
      await page.keyboard.press(key);
      expect(await dialog.evaluate((node) => node.contains(document.activeElement)), `${key} must stay inside native dialog`).toBe(true);
    }
  }
  await opener.evaluate((node) => node.focus());
  expect(await dialog.evaluate((node) => node.contains(document.activeElement)), "background opener is inert").toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
  await qa.assertNoExternalEffects();
});

test("quota selector supports keyboard selection and Escape without losing focus", async ({ page, qa }) => {
  await qa.seed("providers");
  await qa.authenticate(page);
  await page.goto(`${qa.baseURL}/dashboard/quota`);
  const select = page.getByRole("combobox", { name: "Filter quota providers", exact: true });
  await expect(select).toBeVisible();
  await select.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).not.toBeVisible();
  await expect(select).toBeFocused();
  const selected = await select.innerText();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).not.toBeVisible();
  await expect(select).toBeFocused();
  expect(await select.innerText(), "Escape does not commit a highlighted option").toBe(selected);
  await qa.assertNoExternalEffects();
});
