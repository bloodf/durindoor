#!/usr/bin/env node
import { register } from "node:module";

register(new URL("./alias-loader.mjs", import.meta.url));

const { getSettings, updateSettings } = await import("../src/lib/db/repos/settingsRepo.js");
const { runAutoConfigure, getAutoConfigureStatus } = await import("../src/lib/autoConfigure/index.js");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run") || args.includes("-d");

async function upsertFirecrawl(connection, baseUrl) {
  const firecrawlModule = await import("../src/lib/firecrawl/firecrawlConfig.js");
  return firecrawlModule.upsertFirecrawlCustomConnection({
    baseUrl,
    apiKey: connection.apiKey || "",
    headers: connection.firecrawlHeaders ? JSON.parse(connection.firecrawlHeaders) : {},
  });
}

async function firecrawlDeps() {
  const [{ probeDefaultFirecrawlEndpoints }, { getProviderConnections }] = await Promise.all([
    import("../src/lib/firecrawl/firecrawlConfig.js"),
    import("../src/lib/localDb.js"),
  ]);
  return {
    probe: probeDefaultFirecrawlEndpoints,
    listConnections: async ({ provider }) => getProviderConnections({ provider }),
  };
}

async function main() {
  const settings = await getSettings();
  const firecrawl = await firecrawlDeps();

  if (dryRun) {
    const status = await getAutoConfigureStatus(settings, { firecrawl });
    console.log(JSON.stringify({ dryRun: true, ...status }, null, 2));
    return;
  }

  const report = await runAutoConfigure(settings, { dryRun: false, firecrawl });

  if (report.changed) {
    await updateSettings(report.updates);
  }

  const firecrawlReport = report.services.firecrawl;
  if (firecrawlReport.connection && firecrawlReport.baseUrl) {
    try {
      await upsertFirecrawl(firecrawlReport.connection, firecrawlReport.baseUrl);
      report.actions.push("upserted firecrawl custom connection");
    } catch (e) {
      report.actions.push(`firecrawl connection upsert skipped: ${e.message || String(e)}`);
    }
  }

  console.log(JSON.stringify({ dryRun: false, ...report }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
