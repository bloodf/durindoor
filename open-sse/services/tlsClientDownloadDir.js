import { join } from "node:path";
import { getDataDir } from "../../src/lib/dataDir.js";

/**
 * Writable cache directory for tls-client-node's native binary.
 *
 * Without an explicit `downloadDir`, the library defaults to its own package
 * `node_modules/tls-client-node/bin`, which is root-owned on global installs
 * and fails with EACCES for normal users (OmniRoute #8579).
 */
export function resolveTlsClientDownloadDir() {
  return join(getDataDir(), "tls-client", "bin");
}

export function buildNativeTlsClientOptions() {
  return {
    runtimeMode: "native",
    downloadDir: resolveTlsClientDownloadDir(),
  };
}
