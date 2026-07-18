import { getInstallInfo } from "../pxpipe/install.js";

export function detectPxpipe() {
  const info = getInstallInfo();
  return {
    installed: info.installed,
    version: info.version,
    path: info.path,
    reason: info.reason,
    code: info.code,
  };
}

export function configurePxpipe(settings, { dryRun = false } = {}) {
  const report = { changed: false, actions: [] };
  const detected = detectPxpipe();

  if (!detected.installed) {
    report.actions.push("pxpipe-proxy dependency not detected; skipping enable");
    return {
      changed: false,
      wouldChange: false,
      installed: false,
      actions: report.actions,
      updates: {},
    };
  }

  if (!settings.pxpipeEnabled) {
    report.actions.push(dryRun ? "would set pxpipeEnabled to true" : "set pxpipeEnabled to true");
    report.changed = true;
  } else {
    report.actions.push("pxpipeEnabled already true");
  }

  const targetMinChars = 25000;
  if (settings.pxpipeMinChars !== targetMinChars) {
    report.actions.push(dryRun ? `would set pxpipeMinChars to ${targetMinChars}` : `set pxpipeMinChars to ${targetMinChars}`);
    report.changed = true;
  } else {
    report.actions.push(`pxpipeMinChars already ${targetMinChars}`);
  }

  const targetTimeout = 15000;
  if (settings.pxpipeTimeoutMs !== targetTimeout) {
    report.actions.push(dryRun ? `would set pxpipeTimeoutMs to ${targetTimeout}` : `set pxpipeTimeoutMs to ${targetTimeout}`);
    report.changed = true;
  } else {
    report.actions.push(`pxpipeTimeoutMs already ${targetTimeout}`);
  }

  const updates = {};
  if (report.changed && !dryRun) {
    updates.pxpipeEnabled = true;
    updates.pxpipeMinChars = targetMinChars;
    updates.pxpipeTimeoutMs = targetTimeout;
  }

  return {
    changed: report.changed && !dryRun,
    wouldChange: report.changed,
    installed: detected.installed,
    actions: report.actions,
    updates,
  };
}
