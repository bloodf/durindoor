import { setupStoryFixture } from "./fixtures.js";

export function getStoryFixtureOptions(context) {
  const fixture = context.parameters?.storyFixture ?? {};
  return {
    scenario: fixture.scenario,
    locale: fixture.locale ?? context.globals.locale ?? "en",
    pathname: fixture.pathname ?? context.globals.pathname ?? "/dashboard/usage",
    params: fixture.params,
    selectedLayoutSegments: fixture.selectedLayoutSegments,
    routes: fixture.routes,
    externalFixtures: fixture.externalFixtures,
  };
}

export async function setupStoryScope(context) {
  const { cleanup } = await setupStoryFixture(getStoryFixtureOptions(context));
  return async () => { await cleanup(); };
}
