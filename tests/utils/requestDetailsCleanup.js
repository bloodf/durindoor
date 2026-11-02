const SHUTDOWN_SLOT = Symbol.for("durindoor.requestDetailsRepo.shutdown");
const SHUTDOWN_EVENTS = ["beforeExit", "SIGINT", "SIGTERM", "exit"];

/**
 * Persist and release the requestDetailsRepo instance that a test (re)loaded,
 * without importing it: call before closing the DB adapter / deleting DATA_DIR
 * so buffered rows and process listeners do not outlive the temp database.
 */
export async function disposeLoadedRequestDetailsRepo() {
  const registration = globalThis[SHUTDOWN_SLOT];
  if (!registration) return;
  for (const event of SHUTDOWN_EVENTS) process.off(event, registration.handler);
  delete globalThis[SHUTDOWN_SLOT];
  await registration.flush();
}
