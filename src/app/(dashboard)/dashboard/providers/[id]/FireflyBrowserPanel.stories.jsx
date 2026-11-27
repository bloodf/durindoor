import FireflyBrowserPanel from "./FireflyBrowserPanel.jsx";
export default { title: "Production/providers/FireflyBrowserPanel", component: FireflyBrowserPanel, parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/adobe-firefly-web", routes: { "GET /api/providers": { body: { connections: [] } } } } } };
export const Disabled = {};
export const Configured = { parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/providers/adobe-firefly-web", routes: { "GET /api/providers": { body: { connections: [{ id: "synthetic", provider: "adobe-firefly-web", name: "Synthetic operator profile", providerSpecificData: { fireflyWebUi: { enabled: false } } }] } } } } } };
