const TOGGLE_DEFAULTS = {
  rtk: { key: "rtkEnabled", default: true },
  caveman: { key: "cavemanEnabled", default: false, levelKey: "cavemanLevel", levelDefault: "full" },
  ponytail: { key: "ponytailEnabled", default: false, levelKey: "ponytailLevel", levelDefault: "full" },
};

export function configureToggles(settings, { dryRun = false } = {}) {
  const report = { changed: false, actions: [], services: {} };
  const updates = {};

  for (const [name, config] of Object.entries(TOGGLE_DEFAULTS)) {
    const service = { changed: false, wouldChange: false, actions: [] };
    const enabled = !!settings[config.key];

    if (!enabled) {
      service.actions.push(dryRun ? `would set ${config.key} to true` : `${config.key} set to true`);
      service.wouldChange = true;
    } else {
      service.actions.push(`${config.key} already true`);
    }

    if (config.levelKey && settings[config.levelKey] !== config.levelDefault) {
      service.actions.push(dryRun ? `would set ${config.levelKey} to ${config.levelDefault}` : `${config.levelKey} set to ${config.levelDefault}`);
      service.wouldChange = true;
    } else if (config.levelKey) {
      service.actions.push(`${config.levelKey} already ${config.levelDefault}`);
    }

    if (service.wouldChange) {
      service.changed = !dryRun;
      report.changed = true;
      if (!dryRun) {
        updates[config.key] = true;
        if (config.levelKey) updates[config.levelKey] = config.levelDefault;
      }
    }
    report.actions.push(...service.actions);
    report.services[name] = service;
  }

  return {
    changed: report.changed && !dryRun,
    wouldChange: report.changed,
    actions: report.actions,
    services: report.services,
    updates,
  };
}

export { TOGGLE_DEFAULTS };
