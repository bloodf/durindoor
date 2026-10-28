import { isFunction } from "../src/shared/utils/typeChecks.js";
import { setupStoryFixture } from "./fixtures.js";

export function getStoryFixtureOptions(context) {
  const fixture = context.parameters?.storyFixture ?? {};
  const requestedRoute = context.parameters?.v5Review && globalThis.location
    ? new URL(globalThis.location.href).searchParams.get("v5Route") || new URL(window.parent.location.href).searchParams.get("v5Route") : null;
  let pathname = fixture.pathname ?? context.globals.pathname ?? "/dashboard/usage";
  let params = fixture.params;
  let routes = fixture.routes;
  if (requestedRoute?.startsWith("/") && !requestedRoute.startsWith("//")) {
    pathname = requestedRoute;
    const parts = new URL(requestedRoute, "http://storybook.local").pathname.split("/");
    if (parts[2] === "providers" || parts[2] === "timeline") params = { ...params, id: parts[3] };
    // A cross-provider link needs fresh connections, catalogs and sync status;
    // ordinary source stories keep their original fixtures and play contracts.
    if (parts[2] === "providers" && parts.length === 4 && parts[3] && parts[3] !== fixture.params?.id && isFunction(fixture.providerFixture)) {
      const rebound = fixture.providerFixture(parts[3]);
      routes = { ...routes, ...rebound.routes };
    }
    if (parts[2] === "cli-tools") params = { ...params, toolId: parts[3] };
    if (parts[2] === "media-providers") {
      params = { ...params };
      if (parts[3] === "combo") params.id = parts[4];
      else { params.kind = parts[3]; if (parts[4]) params.id = parts[4]; }
    }
  }
  return {
    scenario: fixture.scenario,
    locale: fixture.locale ?? context.globals.locale ?? "en",
    pathname,
    params,
    selectedLayoutSegments: fixture.selectedLayoutSegments,
    routes,
    externalFixtures: fixture.externalFixtures,
  };
}

export async function setupStoryScope(context) {
  const { cleanup } = await setupStoryFixture(getStoryFixtureOptions(context));
  return async () => { await cleanup(); };
}
