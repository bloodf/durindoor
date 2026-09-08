import PxpipePage from "./page";

const routes = {
  "GET /api/pxpipe/status": { body: { installed: true, running: true, enabled: true, version: "1.4.0", uptimeMs: 5400000 } },
  "GET /api/pxpipe/stats": { body: { windows: { last7d: { requests: 12, compressed: 8, bypassed: 4, tokensBeforeEst: 36000, tokensAfterEst: 21000, tokensSavedEst: 15000, savedPct: 42, imagesGenerated: 17, avgCompressionMs: 220, errors: 0 } }, recent: [], timeline: [] } },
  "GET /api/pxpipe/logs?limit=50": { body: { events: [] } },
  "POST /api/pxpipe/health": { body: { healthy: true } },
};

export default {
  title: "Production/pxpipe/PxpipePage",
  component: PxpipePage,
  parameters: { storyFixture: { scenario: "default", pathname: "/dashboard/pxpipe", routes } },
};

export const Default = {};
