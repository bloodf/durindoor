import { configureHeadroom } from "./headroom.js";
import { configurePxpipe } from "./pxpipe.js";
import { configureFirecrawl } from "./firecrawl.js";
import { configureToggles } from "./toggles.js";

export { configureHeadroom, configurePxpipe, configureFirecrawl, configureToggles };

export async function runAutoConfigure(settings, options = {}) {
  const {
    dryRun = false,
    headroomUrl,
    firecrawlApiKey = process.env.FIRECRAWL_API_KEY,
    firecrawlHeaders,
    firecrawl: firecrawlOptions = {},
  } = options;

  const report = {
    dryRun,
    changed: false,
    wouldChange: false,
    services: {},
    actions: [],
    updates: {},
  };

  const headroom = await configureHeadroom(settings, { dryRun, url: headroomUrl });
  const pxpipe = configurePxpipe(settings, { dryRun });
  const firecrawl = await configureFirecrawl(settings, {
    dryRun,
    apiKey: firecrawlOptions.apiKey ?? firecrawlApiKey,
    headers: firecrawlOptions.headers ?? firecrawlHeaders,
    probe: firecrawlOptions.probe,
    listConnections: firecrawlOptions.listConnections,
    override: firecrawlOptions.override,
  });
  const toggles = configureToggles(settings, { dryRun });

  report.services.headroom = headroom;
  report.services.pxpipe = pxpipe;
  report.services.firecrawl = firecrawl;
  report.services.toggles = toggles;

  for (const serviceReport of Object.values(report.services)) {
    Object.assign(report.updates, serviceReport.updates || {});
    report.actions.push(...(serviceReport.actions || []));
    if (serviceReport.changed) report.changed = true;
    if (serviceReport.wouldChange) report.wouldChange = true;
  }

  return report;
}

export async function getAutoConfigureStatus(settings, options = {}) {
  const dryRunReport = await runAutoConfigure(settings, { ...options, dryRun: true });
  return {
    wouldChange: dryRunReport.wouldChange,
    services: dryRunReport.services,
    actions: dryRunReport.actions,
  };
}
