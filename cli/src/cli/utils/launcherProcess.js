const net = require("node:net");

// Probe the address the worker will actually bind. Permission failures and
// uncertain binds retain the existing cleanup path; only a clean bind skips it.
function canBindLauncherPort(port, host) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close((error) => resolve(!error));
    });
  });
}

module.exports = { canBindLauncherPort };
