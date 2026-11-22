// RFC 1929 writes each SOCKS5 credential behind a one-byte length prefix.
// The `socks` client (via socks-proxy-agent) performs that write inside a
// socket data handler, so an over-long value throws where no caller can catch
// it. Refuse it before dialing. SOCKS4 has no length prefix.

export const SOCKS_CREDENTIAL_TOO_LONG = "SOCKS_CREDENTIAL_TOO_LONG";

function decodeUserinfo(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function assertSocksProxyUrl(proxyUrl) {
  let url;
  try {
    url = new URL(proxyUrl);
  } catch {
    return;
  }
  const protocol = url.protocol;
  if (protocol === "socks4:" || protocol === "socks4a:") return;
  if (protocol !== "socks:" && protocol !== "socks5:" && protocol !== "socks5h:") return;
  const userId = decodeUserinfo(url.username);
  const password = decodeUserinfo(url.password);
  if (Buffer.byteLength(userId, "utf8") > 255 || Buffer.byteLength(password, "utf8") > 255) {
    const error = new Error("SOCKS5 credential exceeds the 255-byte length prefix; refusing the proxy");
    error.code = SOCKS_CREDENTIAL_TOO_LONG;
    throw error;
  }
}
