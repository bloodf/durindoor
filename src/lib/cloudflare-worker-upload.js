import { randomBytes } from "node:crypto";

// Cloudflare expects metadata as a plain multipart field, not a file.
export function buildCloudflareWorkerUploadRequest(scriptContent) {
  const boundary = `----durindoor${randomBytes(24).toString("hex")}`;
  const metadata = JSON.stringify({ main_module: "index.js", bindings: [], compatibility_date: "2024-03-20", observability: { enabled: true } });
  const body = Buffer.from([
    `--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n${scriptContent}\r\n`,
    `--${boundary}--\r\n`,
  ].join(""));
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
