const { spawn } = require("child_process");
const path = require("path");
const readline = require("readline");

// PowerShell-based tray for Windows (AV-safe, zero binary deps)

/**
 * Initialize Windows tray using PowerShell NotifyIcon
 * @param {Object} options - { iconPath, tooltip, items, onClick }
 *   items: [{ title, enabled }]
 * @returns {Object|null} controller with sendAction/kill
 */
function initWinTray(options) {
  const { iconPath, tooltip, items, onClick, onReady, onError } = options;
  const scriptPath = path.join(__dirname, "tray.ps1");
  // Each controller owns its child: a delayed kill must never reach a tray
  // created after it (upstream #3026).
  let psProcess;
  let killed = false;

  // Send a JSON command to this PowerShell tray process via stdin
  const sendCommand = (cmd) => {
    if (psProcess.stdin.writable) psProcess.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
  };

  try {
    psProcess = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-InputFormat", "Text",
        "-OutputFormat", "Text",
        "-File", scriptPath,
        "-IconPath", iconPath,
        "-Tooltip", tooltip
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] }
    );
  } catch (err) {
    return null;
  }

  const rl = readline.createInterface({ input: psProcess.stdout });
  rl.on("line", (line) => {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "ready") onReady?.();
      if (evt.type === "click") onClick?.(evt.index);
    } catch (e) {}
  });

  psProcess.once("error", (error) => onError?.(error));
  psProcess.once("exit", () => {
    if (!killed) onError?.(new Error("Windows tray process exited"));
  });
  // A write racing the tray's exit raises EPIPE here; unhandled it would be uncaught.
  psProcess.stdin.on("error", () => {});
  psProcess.stderr.on("data", () => {});

  // Send initial menu items
  items.forEach((item, index) => {
    sendCommand({ action: "add-item", index, title: item.title, enabled: item.enabled });
  });

  return {
    updateItem(index, title, enabled) {
      sendCommand({ action: "update-item", index, title, enabled });
    },
    setTooltip(text) {
      sendCommand({ action: "set-tooltip", text });
    },
    kill() {
      if (killed) return;
      killed = true;
      try {
        sendCommand({ action: "kill" });
      } catch (e) {}
      setTimeout(() => {
        if (!psProcess.killed) {
          try { psProcess.kill(); } catch (e) {}
        }
      }, 300);
    }
  };
}

module.exports = { initWinTray };
