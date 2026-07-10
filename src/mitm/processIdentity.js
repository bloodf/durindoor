const crypto = require("crypto");
const fs = require("fs");
const { execFileSync } = require("child_process");
const {
  FIXED_UNIX_PATH,
  buildMinimalWindowsEnv,
  resolveTrustedUnixBinary,
  resolveWindowsSystemBinary,
} = require("./trustedBinaries");

function canonicalizeProcessStartIdentity(platform, rawIdentity) {
  const normalized = String(rawIdentity || "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;
  if (platform === "win32") return `win32:${normalized}`;
  if (platform === "darwin") {
    return `darwin:sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
  }
  return normalized;
}

/**
 * Return a bounded process-start identity suitable for durable PID ownership.
 * PID plus this value prevents an exited proxy's PID from authorizing a later,
 * unrelated process after PID reuse.
 */
function getProcessStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === "linux") {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) return null;
      const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/);
      const startTicks = fieldsAfterCommand[19];
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      return startTicks && bootId ? `linux:${bootId}:${startTicks}` : null;
    }

    const output = process.platform === "win32"
      ? execFileSync(resolveWindowsSystemBinary("powershell.exe"), [
        "-NoProfile", "-NonInteractive", "-Command",
        `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate`,
      ], { encoding: "utf8", windowsHide: true, timeout: 5000, env: buildMinimalWindowsEnv() })
      : execFileSync(resolveTrustedUnixBinary("ps"), [
        "-p", String(pid), "-o", "lstart=", "-o", "comm=",
      ], {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5000,
        env: { PATH: FIXED_UNIX_PATH, LANG: "C", LC_ALL: "C" },
      });
    return canonicalizeProcessStartIdentity(process.platform, output);
  } catch {
    return null;
  }
}

module.exports = { canonicalizeProcessStartIdentity, getProcessStartIdentity };
