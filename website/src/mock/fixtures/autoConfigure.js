// Auto-configure report rendered by /dashboard/auto-configure and returned by
// /api/settings/auto-configure. Mirrors the per-service report shapes in
// src/lib/autoConfigure/{headroom,pxpipe,firecrawl,toggles}.js for the demo
// machine: Headroom and PxPipe are healthy, Firecrawl runs locally, and the
// ponytail toggle is still off.
import { seedSettings } from "./configSettings.js";

function verb(dryRun, action) {
  return dryRun ? `would ${action}` : action;
}

function headroomReport(settings, dryRun) {
  const url = settings.headroomUrl || "http://localhost:8787";
  const actions = [`headroom reachable at ${url}`];
  const updates = {};
  let changed = false;
  const check = (key, value, label) => {
    if (settings[key] === value) {
      actions.push(`${key} already ${label}`);
      return;
    }
    actions.push(verb(dryRun, `set ${key} to ${label}`));
    if (!dryRun) updates[key] = value;
    changed = true;
  };
  check("headroomEnabled", true, "true");
  check("headroomUrl", url, url);
  check("headroomCompressUserMessages", true, "true");
  return { changed: changed && !dryRun, wouldChange: changed, wouldInstall: false, installed: true, running: true, localUrl: true, actions, updates };
}

function pxpipeReport(settings, dryRun) {
  const actions = [];
  const updates = {};
  let changed = false;
  for (const [key, value] of [["pxpipeEnabled", true], ["pxpipeMinChars", 25000], ["pxpipeTimeoutMs", 15000]]) {
    if (settings[key] === value) {
      actions.push(`${key} already ${value}`);
      continue;
    }
    actions.push(dryRun ? `would set ${key} to ${value}` : `set ${key} to ${value}`);
    if (!dryRun) updates[key] = value;
    changed = true;
  }
  return { changed: changed && !dryRun, wouldChange: changed, installed: true, running: dryRun ? null : true, actions, updates };
}

function firecrawlReport(settings, dryRun) {
  const baseUrl = settings.firecrawlBaseUrl || "http://localhost:3002";
  const actions = settings.firecrawlBaseUrl
    ? [`using configured firecrawlBaseUrl ${baseUrl}`, `firecrawlBaseUrl already ${baseUrl}`]
    : [dryRun ? `would set firecrawlBaseUrl to ${baseUrl}` : `set firecrawlBaseUrl to ${baseUrl}`];
  // Demo-only marker standing in for the firecrawl_custom provider connection.
  const needsConnection = settings.firecrawlConnectionReady !== true;
  if (!needsConnection) actions.push("firecrawl custom connection already up to date");
  else actions.push(dryRun ? "would prepare firecrawl custom connection" : "firecrawl custom connection prepared");
  if (!dryRun && needsConnection) actions.push("upserted firecrawl custom connection");
  const settingsChanged = !settings.firecrawlBaseUrl;
  return {
    changed: !dryRun && (settingsChanged || needsConnection),
    wouldChange: settingsChanged || needsConnection,
    detected: true,
    running: !settings.firecrawlBaseUrl,
    baseUrl,
    actions,
    updates: dryRun ? {} : { ...(settingsChanged ? { firecrawlBaseUrl: baseUrl } : {}), ...(needsConnection ? { firecrawlConnectionReady: true } : {}) },
    connection: null,
  };
}

const TOGGLES = {
  rtk: { key: "rtkEnabled" },
  caveman: { key: "cavemanEnabled", levelKey: "cavemanLevel" },
  ponytail: { key: "ponytailEnabled", levelKey: "ponytailLevel" },
};

function togglesReport(settings, dryRun) {
  const actions = [];
  const services = {};
  const updates = {};
  for (const [name, config] of Object.entries(TOGGLES)) {
    const service = { changed: false, wouldChange: false, actions: [] };
    if (settings[config.key]) service.actions.push(`${config.key} already true`);
    else {
      service.actions.push(dryRun ? `would set ${config.key} to true` : `${config.key} set to true`);
      service.wouldChange = true;
    }
    if (config.levelKey && settings[config.levelKey] !== "full") {
      service.actions.push(dryRun ? `would set ${config.levelKey} to full` : `${config.levelKey} set to full`);
      service.wouldChange = true;
    } else if (config.levelKey) {
      service.actions.push(`${config.levelKey} already full`);
    }
    if (service.wouldChange) {
      service.changed = !dryRun;
      if (!dryRun) {
        updates[config.key] = true;
        if (config.levelKey) updates[config.levelKey] = "full";
      }
    }
    actions.push(...service.actions);
    services[name] = service;
  }
  const wouldChange = Object.values(services).some((service) => service.wouldChange);
  return { changed: wouldChange && !dryRun, wouldChange, actions, services, updates };
}

/** Same shape as runAutoConfigure() in src/lib/autoConfigure/index.js. */
export function buildAutoConfigureReport(settings, { dryRun = false } = {}) {
  const services = {
    headroom: headroomReport(settings, dryRun),
    pxpipe: pxpipeReport(settings, dryRun),
    firecrawl: firecrawlReport(settings, dryRun),
    toggles: togglesReport(settings, dryRun),
  };
  const list = Object.values(services);
  return {
    dryRun,
    changed: list.some((service) => service.changed),
    wouldChange: list.some((service) => service.wouldChange),
    services,
    actions: list.flatMap((service) => service.actions),
    updates: Object.assign({}, ...list.map((service) => service.updates)),
  };
}

/** Same shape as getAutoConfigureStatus(). */
export function buildAutoConfigureStatus(settings) {
  const { wouldChange, services, actions } = buildAutoConfigureReport(settings, { dryRun: true });
  return { wouldChange, services, actions };
}

export const AUTO_CONFIGURE_STATUS = Object.freeze(buildAutoConfigureStatus(seedSettings()));
