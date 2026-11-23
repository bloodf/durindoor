const { execFileSync } = require("child_process");
const { getCliToken } = require("./api/client");
const { getProbeHost } = require("./host");

const STOP_MANAGER_SCRIPT = String.raw`
const fs = require("fs");
const http = require("http");
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const port = Number(input.port);
const host = input.host || "127.0.0.1";
const token = typeof input.token === "string" ? input.token : "";
if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);
const body = JSON.stringify({ preserveDesiredState: input.preserveDesiredState === true });
const req = http.request({
  hostname: host,
  port,
  path: "/api/cli-tools/antigravity-mitm",
  method: "DELETE",
  headers: {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "x-9r-cli-token": token,
  },
}, (res) => {
  res.resume();
  res.on("end", () => process.exit(res.statusCode >= 200 && res.statusCode < 300 ? 0 : 2));
});
req.setTimeout(360000, () => req.destroy());
req.on("error", () => process.exit(2));
req.end(body);
`;

function stopMitmViaManagerSync(port, {
  execFile = execFileSync,
  nodePath = process.execPath,
  cliToken = getCliToken(),
  preserveDesiredState = true,
  host = "127.0.0.1",
} = {}) {
  try {
    const input = { port, token: cliToken, preserveDesiredState };
    if (host !== "127.0.0.1") input.host = getProbeHost(host);
    execFile(nodePath, ["-e", STOP_MANAGER_SCRIPT], {
      input: JSON.stringify(input),
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 370000,
      windowsHide: true,
      env: { PATH: process.env.PATH || "" },
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { STOP_MANAGER_SCRIPT, stopMitmViaManagerSync };
