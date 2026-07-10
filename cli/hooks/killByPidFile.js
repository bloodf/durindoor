/**
 * Kill a process by reading its PID from a file (best-effort, removes the
 * file after). Used to stop detached helpers — Headroom proxy, cloudflared /
 * tailscale tunnels — that outlive the main server and otherwise hold a
 * handle on the app/ directory on Windows (#2265, upstream #2324).
 *
 * Injectable `fsImpl` / `execImpl` / `killImpl` keep tests off the real
 * process table and filesystem.
 */
function killByPidFile(pidFile, { fsImpl, execImpl, killImpl, platform } = {}) {
  const f = fsImpl || require("fs");
  const run = execImpl || require("child_process").execSync;
  const kill = killImpl || ((pid, sig) => process.kill(pid, sig));
  const plat = platform || process.platform;
  try {
    if (!f.existsSync(pidFile)) return false;
    const raw = String(f.readFileSync(pidFile, "utf8")).trim();
    // Canonical positive safe integer only: reject "", "0", "-1", "1.2", "1e3".
    // A negative pid to process.kill would signal a whole process group.
    if (!/^[1-9]\d*$/.test(raw)) return false;
    const pid = Number(raw);
    if (!Number.isSafeInteger(pid)) return false;
    try {
      if (plat === "win32") {
        run(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 });
      } else {
        kill(pid, "SIGKILL");
      }
    } catch { /* target already gone — best effort */ }
    try { f.unlinkSync(pidFile); } catch { /* ignore */ }
    return true;
  } catch {
    return false;
  }
}

module.exports = { killByPidFile };
