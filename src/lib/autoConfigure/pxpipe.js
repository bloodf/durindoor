import { getInstallInfo } from "../pxpipe/install.js";
import { selfTest } from "../pxpipe/loader.js";

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

export async function configurePxpipe(settings, { dryRun = false } = {}) {
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

  if (!dryRun) {
    try {
      const health = await selfTest();
      if (health?.ok !== true) throw new Error(health?.reason || "self-test returned unhealthy");
    } catch (error) {
      const message = error.message || String(error);
      return {
        changed: false,
        wouldChange: false,
        installed: detected.installed,
        running: false,
        actions: [`pxpipe-proxy health check failed: ${message}`],
        updates: {},
      };
    }
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
    running: dryRun ? null : true,
    actions: report.actions,
    updates,
  };
}
