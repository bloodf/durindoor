const SHUTDOWN_TIMEOUT_MS = 2_000;

function isStopped(proc) {
  // Node leaves exitCode null for signal termination and sets signalCode instead.
  return proc.exitCode !== null || proc.signalCode !== null;
}

function waitForClose(proc, timeoutMs) {
  return new Promise((resolve) => {
    let timer;
    const finish = (closed) => {
      clearTimeout(timer);
      proc.off("close", onClose);
      resolve(closed);
    };
    const onClose = () => finish(true);
    proc.once("close", onClose);
    if (isStopped(proc)) return finish(true);
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

export async function closeProcess(proc, { timeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
  if (!proc || isStopped(proc)) return;

  // Register before signaling: close means stdio is drained and DB owner is gone.
  const stoppedAfterTerm = waitForClose(proc, timeoutMs);
  proc.kill("SIGTERM");
  if (await stoppedAfterTerm || isStopped(proc)) return;

  const stoppedAfterKill = waitForClose(proc, timeoutMs);
  proc.kill("SIGKILL");
  if (await stoppedAfterKill || isStopped(proc)) return;

  throw new Error("[ui-qa] server did not stop after SIGKILL");
}
