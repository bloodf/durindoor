const fs = require("fs");
const { execFile } = require("child_process");
const { LSOF_BIN } = require("./config");
const { resolveWindowsSystemBinary } = require("./trustedBinaries");

function isLoopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function parseProcTcpOwner(raw, { clientPort, targetPorts, ownerUid }) {
  const clientHex = clientPort.toString(16).toUpperCase().padStart(4, "0");
  const targetHex = new Set(targetPorts.map((port) => port.toString(16).toUpperCase().padStart(4, "0")));
  for (const line of String(raw || "").split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 9 || fields[3] !== "01") continue;
    const [localAddress, localPort] = (fields[1] || "").split(":");
    const [remoteAddress, remotePort] = (fields[2] || "").split(":");
    const uid = Number(fields[7]);
    if (localAddress === "0100007F"
      && remoteAddress === "0100007F"
      && localPort === clientHex
      && targetHex.has(remotePort)
      && uid === ownerUid) return true;
  }
  return false;
}

function parseLsofOwner(raw, { clientPort, targetPorts, ownerUid }) {
  let uid = null;
  const targetPattern = targetPorts.join("|");
  const endpoint = new RegExp(`^(?:127\\.0\\.0\\.1|\\[::1\\]):${clientPort}->(?:127\\.0\\.0\\.1|\\[::1\\]):(?:${targetPattern})$`);
  for (const line of String(raw || "").split("\n")) {
    if (line.startsWith("p")) uid = null;
    else if (line.startsWith("u") && /^u\d+$/.test(line)) uid = Number(line.slice(1));
    else if (line.startsWith("n") && uid === ownerUid && endpoint.test(line.slice(1))) return true;
  }
  return false;
}

function execFileText(command, args, { timeout = 3000, maxBuffer = 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", windowsHide: true, timeout, maxBuffer }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function encodePowerShell(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function createPeerOwnerVerifier({
  platform = process.platform,
  processImpl = process,
  readFile = fs.readFileSync,
  execText = execFileText,
  lsofBin = LSOF_BIN,
  targetPorts = [443, 8443],
} = {}) {
  const verifiedSockets = new WeakSet();
  const ownerUid = platform === "win32"
    ? null
    : typeof processImpl.geteuid === "function" ? processImpl.geteuid() : processImpl.getuid?.();

  return async function verifyPeerOwner(socket) {
    if (!socket || !isLoopbackAddress(socket.remoteAddress) || !isLoopbackAddress(socket.localAddress)) return false;
    if (verifiedSockets.has(socket)) return true;
    const clientPort = Number(socket.remotePort);
    if (!Number.isSafeInteger(clientPort) || clientPort < 1 || clientPort > 65535) return false;

    let verified = false;
    try {
      if (platform === "linux") {
        if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) return false;
        verified = parseProcTcpOwner(readFile("/proc/net/tcp", "utf8"), {
          clientPort,
          targetPorts,
          ownerUid,
        });
      } else if (platform === "darwin") {
        if (!Number.isSafeInteger(ownerUid) || ownerUid < 0) return false;
        const output = await execText(lsofBin, [
          "-nP",
          "-a",
          `-iTCP:${clientPort}`,
          "-sTCP:ESTABLISHED",
          "-Fpun",
        ]);
        verified = parseLsofOwner(output, { clientPort, targetPorts, ownerUid });
      } else if (platform === "win32") {
        const ports = targetPorts.join(",");
        const script = `
          $ErrorActionPreference = 'Stop'
          $connection = Get-NetTCPConnection -State Established -LocalAddress 127.0.0.1 -LocalPort ${clientPort} -RemoteAddress 127.0.0.1 -ErrorAction SilentlyContinue |
            Where-Object { @(${ports}) -contains $_.RemotePort } |
            Select-Object -First 1
          if ($null -eq $connection) { exit 3 }
          $ownerResult = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" |
            Invoke-CimMethod -MethodName GetOwnerSid
          $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
          if ($ownerResult.Sid -ne $currentSid) { exit 4 }
          [Console]::Out.Write('verified')
        `;
        verified = (await execText(resolveWindowsSystemBinary("powershell.exe"), [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy", "Bypass",
          "-EncodedCommand", encodePowerShell(script),
        ])).trim() === "verified";
      }
    } catch {
      verified = false;
    }

    if (verified) verifiedSockets.add(socket);
    return verified;
  };
}

module.exports = {
  createPeerOwnerVerifier,
  isLoopbackAddress,
  parseLsofOwner,
  parseProcTcpOwner,
};
