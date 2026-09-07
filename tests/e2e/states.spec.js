import { test, expect } from "./fixtures.js";

const narrowRoutes = [
  { id: "R03", url: "/dashboard/cli-tools/copilot", kind: "404", expectedText: "This page could not be found.", expected404Path: "/dashboard/cli-tools/copilot" },
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
