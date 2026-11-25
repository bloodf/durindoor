// Node reports every handshake or socket failure as a bare "fetch failed"; the
// reason is only on error.cause (upstream decolua/9router#2922).
const UNTRUSTED_CERT_CODE = /CERT|UNABLE_TO_VERIFY/;

const CA_HINT = " The tunnel worker certificate is not trusted: set NODE_EXTRA_CA_CERTS to the PEM file of its issuing CA and restart.";

/**
 * fetch() for the tunnel worker. Certificate verification stays on; failures
 * carry the underlying cause code.
 */
export async function workerFetch(url, init) {
  try {
    return await fetch(url, init);
  } catch (error) {
    const code = error?.cause?.code;
    if (!code) throw error;
    const hint = UNTRUSTED_CERT_CODE.test(code) ? CA_HINT : "";
    throw new Error(`${error.message} (cause: ${code})${hint}`, { cause: error });
  }
}
