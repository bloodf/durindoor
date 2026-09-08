import { test as rawTest, expect, authSensitiveTest } from "./fixtures.js";

function modalSection(page, headingName) {
  return page.getByRole("dialog", { name: headingName, exact: true });
}

authSensitiveTest("R08 real backend workflow creates, reveals, reloads, and disposes a key", async ({ page, qa }) => {
  await qa.seed("key");
  const createdIds = [];
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/endpoint`, { waitUntil: "domcontentloaded" });
    const name = `qa-${Date.now()}`;
    await page.getByRole("button", { name: "Create Key", exact: true }).first().click();
    const createSection = modalSection(page, "Create API Key");
    await expect(createSection).toBeVisible();
    await createSection.getByPlaceholder("Production Key", { exact: true }).fill(name);
    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/keys" && response.request().method() === "POST" && response.ok()),
      createSection.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    const createBody = await createResponse.json().catch(() => ({}));
    const createdId = createBody?.id;
    expect(createdId, "create key response must provide an ID for exact cleanup").toBeDefined();
    createdIds.push(createdId);
    const createdSection = modalSection(page, "API Key Created");
    await expect(createdSection).toBeVisible();
    // One-time controls: secret is rendered in this dialog; observation only,
    // never asserted via text/value because doing so would land the raw key in
    // the trace. authSensitiveTest already disabled traces/screenshots.
    await expect(createdSection.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
    await expect(createdSection.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await createdSection.getByRole("button", { name: "Done", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    const keyRow = page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
    await keyRow.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
    const confirmSection = modalSection(page, "Delete API Key");
    await expect(confirmSection).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/keys/${createdId}` && response.request().method() === "DELETE" && response.ok()),
      confirmSection.getByRole("button", { name: "Confirm", exact: true }).click(),
    ]);
    createdIds.length = 0;
    await expect(page.getByText(name, { exact: false })).toHaveCount(0);
  } finally {
    for (const id of createdIds) {
      const response = await page.request.delete(`${qa.baseURL}/api/keys/${id}`);
      expect(response.ok(), `cleanup must delete created key ${id}`).toBe(true);
    }
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

rawTest("R05a real backend workflow creates, reloads, and disposes a combo", async ({ page, qa }) => {
  const seed = await qa.seed("combo");
  const [seedCombo] = seed.records.combos;
  expect(seedCombo, "combo seed must provide a selectable model source").toBeDefined();
  const createdIds = [];
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/combos`, { waitUntil: "domcontentloaded" });
    const name = `qa-create-${Date.now()}`;
    await page.getByRole("button", { name: "Create Combo", exact: true }).first().click();
    const createSection = modalSection(page, "Create Combo");
    await expect(createSection).toBeVisible();
    await createSection.getByPlaceholder("my-combo", { exact: true }).fill(name);
    await createSection.getByRole("button", { name: "Add Model", exact: true }).click();
    const picker = modalSection(page, "Add Model to Combo");
    await expect(picker).toBeVisible();
    await picker.getByRole("region", { name: "Combos", exact: true }).getByRole("button").filter({ hasText: seedCombo.name }).click();
    await picker.getByRole("button", { name: "Close", exact: true }).click();
    const [createResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/combos" && response.request().method() === "POST" && response.status() === 201),
      createSection.getByRole("button", { name: "Create", exact: true }).click(),
    ]);
    const created = await createResponse.json().catch(() => ({}));
    expect(created?.id, "create combo response must provide an ID for exact cleanup").toBeDefined();
    createdIds.push(created.id);
    await page.reload({ waitUntil: "domcontentloaded" });
    const card = page.locator("div.rounded-dd-lg.border-dd-border", { has: page.getByText(name, { exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const confirmSection = modalSection(page, "Delete Combo");
    await expect(confirmSection).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/combos/${created.id}` && response.request().method() === "DELETE" && response.ok()),
      confirmSection.getByRole("button", { name: "Confirm", exact: true }).click(),
    ]);
    createdIds.length = 0;
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  } finally {
    for (const id of createdIds) {
      const response = await page.request.delete(`${qa.baseURL}/api/combos/${id}`);
      expect(response.ok(), `cleanup must delete created combo ${id}`).toBe(true);
    }
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

rawTest("R05 real backend workflow edits disposable combo and reloads persistence", async ({ page, qa }) => {
  const seed = await qa.seed("combo");
  const [combo] = seed.records.combos;
  expect(combo, "combo seed must provide first editable record").toBeDefined();
  const originalName = combo.name;
  expect(originalName, "first combo seed record must have name").toBeTruthy();
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/combos`, { waitUntil: "domcontentloaded" });
    const card = page.locator("div.rounded-dd-lg.border-dd-border", { has: page.getByText(originalName, { exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Edit", exact: true }).click();
    const editSection = modalSection(page, "Edit Combo");
    await expect(editSection).toBeVisible();
    const comboNameInput = editSection.getByPlaceholder("my-combo", { exact: true });
    const newName = `qa-rename-${Date.now()}`;
    await expect(comboNameInput).toBeVisible();
    await comboNameInput.fill(newName);
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/combos/${combo.id}` && response.request().method() === "PUT" && response.ok()),
      editSection.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(newName, { exact: false }).first()).toBeVisible();
  } finally {
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

rawTest("R05b combo delete removes the disposable card", async ({ page, qa }) => {
  const seed = await qa.seed("combo");
  const [combo] = seed.records.combos;
  expect(combo, "combo seed must provide a deletable record").toBeDefined();
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/combos`, { waitUntil: "domcontentloaded" });
    const card = page.locator("div.rounded-dd-lg.border-dd-border", { has: page.getByText(combo.name, { exact: true }) });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Delete", exact: true }).click();
    const confirmSection = modalSection(page, "Delete Combo");
    await expect(confirmSection).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/combos/${combo.id}` && response.request().method() === "DELETE" && response.ok()),
      confirmSection.getByRole("button", { name: "Confirm", exact: true }).click(),
    ]);
    await expect(page.getByText(combo.name, { exact: true })).toHaveCount(0);
  } finally {
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

authSensitiveTest("R09 compatible provider edit validates fake upstream and persists save", async ({ page, qa }) => {
  const seed = await qa.seed("baseline");
  const node = seed.records.mediaProviders?.find((record) => record.type === "openai-compatible");
  expect(node, "baseline seed must provide an editable OpenAI-compatible node").toBeDefined();
  const updatedName = `QA provider ${Date.now()}`;
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/providers/${node.id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const editSection = modalSection(page, "Edit OpenAI Compatible");
    await expect(editSection).toBeVisible();
    await editSection.getByLabel("Name", { exact: true }).fill(updatedName);
    await editSection.getByLabel("Base URL", { exact: true }).fill("http://fake-upstream:4100/v1");
    await editSection.getByLabel("API Key (for Check)", { exact: true }).fill("qa-fixture-key");
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/provider-nodes/validate" && response.request().method() === "POST" && response.ok()),
      editSection.getByRole("button", { name: "Check", exact: true }).click(),
    ]);
    await expect(editSection.getByText("Valid", { exact: true })).toBeVisible();
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/provider-nodes/${node.id}` && response.request().method() === "PUT" && response.ok()),
      editSection.getByRole("button", { name: "Save", exact: true }).click(),
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(updatedName, { exact: true })).toBeVisible();
  } finally {
    // The public seed descriptor deliberately exposes only node identity; no
    // synthetic restore write is needed because qa.reset deletes exact IDs.
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

authSensitiveTest("R09b provider edit validation surfaces Invalid badge for unreachable base URL", async ({ page, qa }) => {
  const seed = await qa.seed("baseline");
  const node = seed.records.mediaProviders?.find((record) => record.type === "openai-compatible");
  expect(node, "baseline seed must provide an editable OpenAI-compatible node").toBeDefined();
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/providers/${node.id}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    const editSection = modalSection(page, "Edit OpenAI Compatible");
    await expect(editSection).toBeVisible();
    await editSection.getByLabel("Base URL", { exact: true }).fill("http://fake-upstream:4101/v1");
    await editSection.getByLabel("API Key (for Check)", { exact: true }).fill("qa-fixture-key");
    await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/provider-nodes/validate" && response.request().method() === "POST"),
      editSection.getByRole("button", { name: "Check", exact: true }).click(),
    ]);
    await expect(editSection.getByText("Invalid", { exact: true })).toBeVisible();
  } finally {
    await page.getByRole("dialog", { name: "Edit OpenAI Compatible", exact: true }).getByRole("button", { name: "Cancel", exact: true }).click();
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

rawTest("R20 token-saver settings round trip uses harmless numeric setting", async ({ page, qa }) => {
  await qa.seed("baseline");
  const minCharsInput = () => page.getByLabel("Minimum chars", { exact: true });
  const isPxpipePatch = (value) => (response) => {
    if (new URL(response.url()).pathname !== "/api/settings" || response.request().method() !== "PATCH" || !response.ok()) return false;
    try {
      const body = JSON.parse(response.request().postData() || "{}");
      return Object.prototype.hasOwnProperty.call(body, "pxpipeMinChars") && body.pxpipeMinChars === value;
    } catch {
      return false;
    }
  };
  let originalValue;
  try {
    await qa.authenticate(page);
    const [settingsResponse] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/settings" && response.request().method() === "GET" && response.ok()),
      page.goto(`${qa.baseURL}/dashboard/token-saver/settings`, { waitUntil: "domcontentloaded" }),
    ]);
    const settingsBody = await settingsResponse.json().catch(() => ({}));
    originalValue = String(settingsBody?.pxpipeMinChars ?? 25000);
    await expect(minCharsInput(), "settings input must hydrate to saved value before the test mutates it").toHaveValue(originalValue);
    const next = String(Math.max(1, Number.parseInt(originalValue, 10) + 1));
    await minCharsInput().fill(next);
    await Promise.all([
      page.waitForResponse(isPxpipePatch(Number(next))),
      minCharsInput().blur()
    ]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(minCharsInput(), "token-saver min chars persisted across reload").toHaveValue(next);
  } finally {
    if (originalValue !== undefined) {
      await minCharsInput().fill(originalValue);
      const [restoreResponse] = await Promise.all([
        page.waitForResponse(isPxpipePatch(Number(originalValue))),
        minCharsInput().blur()
      ]);
      const restoreBody = JSON.parse(restoreResponse.request().postData() || "{}");
      expect(restoreBody.pxpipeMinChars, "restore PATCH must include the original pxpipeMinChars").toBe(Number(originalValue));
    }
    await qa.reset();
  }
  await qa.assertNoExternalEffects();
});

async function pickSeededChatModel(page, seed) {
  expect(seed.chatConnection?.id, "baseline seed must provide a compatible chat connection").toBeDefined();
  expect(seed.provider, "baseline seed must provide a compatible chat provider").toBeDefined();
  expect(seed.model, "baseline seed must provide a fake-upstream chat model").toBeDefined();
  const exactModelId = `${seed.provider}/${seed.model}`;
  const trigger = page.locator('button[aria-haspopup="listbox"]').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
  const option = page.getByRole("option").filter({ hasText: exactModelId }).first();
  await expect(option, "playground must offer the exact seeded compatible model").toBeVisible();
  await option.click();
  await expect(trigger).toContainText(exactModelId);
}

async function injectFakeUpstreamMode(page, mode) {
  const handler = async (route) => {
    const request = route.request();
    const raw = request.postData() || "{}";
    let body;
    try { body = JSON.parse(raw); } catch { body = {}; }
    body.metadata = { ...(body.metadata || {}), qa_mode: mode };
    const serialized = JSON.stringify(body);
    // route.fallback lets the context-level destination guard/audit see this
    // request; route.continue would bypass both. The override postData/headers
    // are forwarded so the upstream fetch keeps the metadata body.
    await route.fallback({ postData: serialized, headers: { ...request.headers(), "content-length": String(serialized.length) } });
  };
  await page.route("**/v1/chat/completions", handler);
  return async () => { await page.unroute("**/v1/chat/completions", handler); };
}
rawTest("R19 playground streams a fake-upstream chat reply and shows the assistant text", async ({ page, qa }) => {
  const seed = await qa.seed("baseline");
  let detachMode;
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/playground`, { waitUntil: "domcontentloaded" });
    await pickSeededChatModel(page, seed);
    detachMode = await injectFakeUpstreamMode(page, "success");
    const composer = page.getByLabel("Message input", { exact: true });
    await composer.fill("Hello fixture");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("QA fixture response", { exact: true })).toBeVisible({ timeout: 15_000 });
    await qa.assertNoExternalEffects();
  } finally {
    if (detachMode) await detachMode();
    await qa.reset();
  }
});

rawTest("R19b playground surfaces the upstream error message and an error badge", async ({ page, qa }) => {
  const seed = await qa.seed("baseline");
  let detachMode;
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/playground`, { waitUntil: "domcontentloaded" });
    await pickSeededChatModel(page, seed);
    detachMode = await injectFakeUpstreamMode(page, "error");
    const composer = page.getByLabel("Message input", { exact: true });
    await composer.fill("trigger error");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    const assistant = page.getByRole("listitem").filter({ hasText: "[429]: Rate limit exceeded" });
    await expect(assistant).toBeVisible({ timeout: 15_000 });
    await expect(assistant.getByText("Error", { exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  } finally {
    if (detachMode) await detachMode();
    await qa.reset();
  }
});

rawTest("R19c playground Stop button aborts a long-running fake-upstream stream", async ({ page, qa }) => {
  const seed = await qa.seed("baseline");
  let detachMode;
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/playground`, { waitUntil: "domcontentloaded" });
    await pickSeededChatModel(page, seed);
    detachMode = await injectFakeUpstreamMode(page, "cancel");
    const composer = page.getByLabel("Message input", { exact: true });
    await composer.fill("trigger stop on long stream");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    // Fake-upstream cancel branch streams a content chunk then holds the
    // socket open with heartbeats; partial text must be observable before
    // the Stop click, then the UI re-enables Send and preserves that text.
    await expect(page.getByText("QA fixture streaming", { exact: true })).toBeVisible({ timeout: 15_000 });
    const stopButton = page.getByRole("button", { name: "Stop", exact: true });
    await expect(stopButton).toBeVisible();
    await stopButton.click();
    await expect(stopButton).not.toBeVisible();
    await page.getByLabel("Message input", { exact: true }).fill("Next request");
    await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByText("QA fixture streaming", { exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  } finally {
    if (detachMode) await detachMode();
    await qa.reset();
  }
});
