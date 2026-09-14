import { test, expect } from "./fixtures.js";

const narrowRoutes = [
  { id: "R03", url: "/dashboard/cli-tools/no-such-tool", kind: "404", expectedText: "This page could not be found.", expected404Path: "/dashboard/cli-tools/no-such-tool" },
  { id: "R10", url: "/dashboard/health", kind: "empty", seedScenario: "empty", expectedText: "No active connections configured." },
  { id: "R27", url: "/dashboard/timeline/no-such-trace", kind: "404", expectedText: "Trace not found", expected404Path: "/api/timeline/no-such-trace" },
  { id: "R33", url: "/callback?error=fixture-error&error_description=fixture", kind: "error", expectedText: "Authorization failed" }
];

for (const { id, url, seedScenario = "baseline", expectedText, kind, expected404Path } of narrowRoutes) {
  test(`${id} state ${kind} renders explicitly`, async ({ page, qa }) => {
    await qa.seed(seedScenario);
    const errors = [];
    const onPageError = (error) => errors.push(error.message);
    const onConsole = (message) => {
      if (message.type() !== "error") return;
      const location = message.location()?.url;
      if (expected404Path && location && message.text().includes("404") && new URL(location).pathname === expected404Path) return;
      errors.push(message.text());
    };
    page.on("pageerror", onPageError);
    page.on("console", onConsole);
    try {
      await qa.authenticate(page);
      const response = await page.goto(`${qa.baseURL}${url}`, { waitUntil: "domcontentloaded" });
      if (id === "R03") {
        expect(response).not.toBeNull();
        expect(response.status()).toBe(404);
      }
      await expect(page.getByText(expectedText, { exact: true }).first()).toBeVisible();
      await qa.assertNoExternalEffects();
      expect(errors, `${id} expected scoped errors`).toEqual([]);
    } finally {
      page.off("pageerror", onPageError);
      page.off("console", onConsole);
      await qa.reset();
    }
  });
}

test("R03 GitHub Copilot guide is a supported route", async ({ page, qa }) => {
  await qa.seed("baseline");
  try {
    await qa.authenticate(page);
    const response = await page.goto(`${qa.baseURL}/dashboard/cli-tools/copilot`, { waitUntil: "domcontentloaded" });
    expect(response).not.toBeNull();
    expect(response.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "GitHub Copilot", exact: true })).toBeVisible();
    await expect(page.getByText("Install Extension", { exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  } finally {
    await qa.reset();
  }
});

test("R10 failed health request surfaces a scoped error, not a hang", async ({ page, qa }) => {
  await qa.seed("providers");
  let intercepted = false;
  const handler = async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/health/providers") return route.fallback();
    intercepted = true;
    await route.fulfill({ status: 500, contentType: "application/json", body: "not-json" });
  };
  await page.route("**/*", handler);
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/health`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Provider Health", exact: true })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Health request failed (500)" })).toBeVisible();
    expect(intercepted, "expected exact /api/health/providers intercept").toBe(true);
    await expect(page.getByText("Unavailable (fail-open)", { exact: true })).toBeVisible();
    await qa.assertNoExternalEffects();
  } finally {
    await page.unroute("**/*", handler);
    await qa.reset();
  }
});

test("R08 endpoint error injection stays on exact keys collection path", async ({ page, qa }) => {
  await qa.seed("key");
  const handler = async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/keys") return route.fallback();
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "injected" }) });
  };
  await page.route("**/*", handler);
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/endpoint`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("injected", { exact: false }).first()).toBeVisible();
    await qa.assertNoExternalEffects();
  } finally {
    await page.unroute("**/*", handler);
    await qa.reset();
  }
});

test("R25 quota desktop toolbar keeps filters and actions on one row", async ({ page, qa }) => {
  await qa.seed("providers");
  try {
    await page.setViewportSize({ width: 1336, height: 900 });
    await qa.authenticate(page);
    for (const variant of ["all", "codex"]) {
      if (variant === "codex") {
        // Geometry-only catalog: exercise the real extra filter without OAuth or quota requests.
        await page.route("**/api/providers/client?*", async (route) => {
          const response = await route.fetch();
          const data = await response.json();
          await route.fulfill({ response, json: {
            ...data, connections: [], providerOptions: ["codex"],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
          } });
        });
      }
      await page.goto(`${qa.baseURL}/dashboard/quota?provider=${variant}`, { waitUntil: "domcontentloaded" });
      const provider = page.getByRole("combobox", { name: "Filter quota providers", exact: true });
      const controls = [
        provider,
        page.getByRole("combobox", { name: "Filter accounts by status", exact: true }),
        ...(variant === "codex" ? [page.getByRole("combobox", { name: "Sort Codex quotas by remaining", exact: true })] : []),
        page.getByRole("button", { name: "Expiring", exact: true }),
        page.getByRole("button", { name: "Disable empty", exact: true }),
        page.getByRole("button", { name: "Enable available", exact: true }),
        page.getByRole("button", { name: /^Auto/ }),
        page.getByRole("button", { name: "Refresh all", exact: true }),
      ];
      await expect(provider).toHaveText(variant === "all" ? /All providers/ : /codex/);
      const boxes = await Promise.all(controls.map(async (control) => {
        await expect(control).toBeVisible();
        return control.boundingBox();
      }));
      expect(boxes.every(Boolean), "quota toolbar controls must have rendered geometry").toBe(true);
      const tops = boxes.map((box) => box.y);
      expect(Math.max(...tops) - Math.min(...tops), `${variant} quota toolbar must stay on one desktop row`).toBeLessThan(4);
      const contentBox = await page.getByRole("region", { name: "Page content", exact: true }).boundingBox();
      expect(contentBox.width, "quota desktop content must leave enough width for one-row toolbar").toBeGreaterThanOrEqual(1000);
    }
    await qa.assertNoExternalEffects();
  } finally {
    await qa.reset();
  }
});

test("R22 provider status All option is selectable and clears status filter", async ({ page, qa }) => {
  await qa.seed("providers");
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/providers`, { waitUntil: "domcontentloaded" });
    const status = page.getByRole("combobox", { name: "Provider status", exact: true });
    await status.click();
    await page.getByRole("option", { name: "Not configured", exact: true }).click();
    await expect(status).toHaveText(/Not configured/);
    await status.click();
    await page.getByRole("option", { name: "All", exact: true }).click();
    await expect(status).toHaveText(/^All/);
    await expect(page.getByText("No providers match current filters", { exact: true })).toHaveCount(0);
    await qa.assertNoExternalEffects();
  } finally {
    await qa.reset();
  }
});

test("R20 settings tabs switch without discarding unsaved OIDC draft", async ({ page, qa }) => {
  await qa.seed("baseline");
  try {
    await qa.authenticate(page);
    await page.goto(`${qa.baseURL}/dashboard/profile`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Security", exact: true }).click();
    await page.getByRole("button", { name: "Toggle OIDC settings", exact: true }).click();
    const issuer = page.getByLabel("Issuer URL", { exact: true });
    await issuer.fill("https://qa.example.test/oidc");
    await page.getByRole("tab", { name: "General", exact: true }).click();
    await expect(page.getByRole("tabpanel", { name: "General settings", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Security", exact: true }).click();
    await expect(issuer).toHaveValue("https://qa.example.test/oidc");
    await qa.assertNoExternalEffects();
  } finally {
    await qa.reset();
  }
});
