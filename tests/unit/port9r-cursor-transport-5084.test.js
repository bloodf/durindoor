import http2 from "http2";
import net from "net";
import tls from "tls";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SocksProxyAgent } from "socks-proxy-agent";
import selfsigned from "selfsigned";

import { connectHttp2 } from "../../open-sse/utils/http2Connect.js";

const repoRoot = new URL("../../", import.meta.url).pathname;
const helperUrl = new URL("../../open-sse/utils/http2Connect.js", import.meta.url).href;
const openSockets = new Set();
const servers = [];
let certs;
let tempDir;
let caPath;

function track(server) {
  servers.push(server);
  server.on("connection", (socket) => {
    openSockets.add(socket);
    socket.on("error", () => {}); // Teardown may reset a still-piped loopback peer.
    socket.once("close", () => openSockets.delete(socket));
  });
  return server;
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

function runTrustedClient(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "--eval", code], {
      cwd: repoRoot,
      env: { PATH: process.env.PATH, NODE_EXTRA_CA_CERTS: caPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (status) => {
      if (status === 0) resolve(stdout.trim());
      else reject(new Error(stderr || stdout || `child exited ${status}`));
    });
  });
}

function connectProxyServer(onConnect) {
  return track(net.createServer((socket) => {
    let request = "";
    socket.on("data", function onData(chunk) {
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      socket.off("data", onData);
      onConnect(socket, request);
    });
  }));
}

beforeAll(async () => {
  const ca = await selfsigned.generate([{ name: "commonName", value: "transport-test-ca" }], {
    algorithm: "sha256",
    extensions: [
      { name: "basicConstraints", cA: true, critical: true },
      { name: "keyUsage", keyCertSign: true, cRLSign: true, critical: true },
    ],
  });
  certs = await selfsigned.generate([{ name: "commonName", value: "localhost" }], {
    algorithm: "sha256",
    ca: { key: ca.private, cert: ca.cert },
    extensions: [
      { name: "basicConstraints", cA: false, critical: true },
      { name: "keyUsage", digitalSignature: true, keyEncipherment: true, critical: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames: [{ type: 2, value: "localhost" }] },
    ],
  });
  tempDir = await mkdtemp(join(tmpdir(), "9router-http2-"));
  caPath = join(tempDir, "ca.pem");
  await writeFile(caPath, ca.cert);
});

afterAll(async () => {
  for (const socket of openSockets) socket.destroy();
  await Promise.all(servers.map(close));
  await rm(tempDir, { recursive: true, force: true });
});

describe("HTTP/2 CONNECT transport", () => {
  it("provides SOCKS timeout cleanup and clears the inherited idle timer", async () => {
    const socket = new net.Socket();
    const destroy = vi.spyOn(socket, "destroy");
    const setTimeout = vi.spyOn(socket, "setTimeout");
    let req;
    const connect = vi.spyOn(SocksProxyAgent.prototype, "connect").mockImplementation(async (request) => {
      req = request;
      socket.setTimeout(1000);
      socket.on("timeout", () => { request.destroy(); socket.destroy(); });
      return socket;
    });
    const upgrade = vi.spyOn(tls, "connect").mockImplementation(() => {
      expect(setTimeout).toHaveBeenLastCalledWith(0);
      socket.emit("timeout");
      throw new Error("timeout cleanup checked");
    });
    try {
      await expect(connectHttp2("https://localhost/", { proxyUrl: "socks5h://localhost:9" }))
        .rejects.toThrow("timeout cleanup checked");
      expect(req.destroy).toBeTypeOf("function");
      expect(destroy).toHaveBeenCalled();
    } finally {
      upgrade.mockRestore();
      connect.mockRestore();
      socket.destroy();
    }
  });

  it("tunnels through a certificate-verified HTTPS proxy", async () => {
    const target = track(http2.createSecureServer({ key: certs.private, cert: certs.cert }));
    target.on("stream", (stream) => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });
    const targetPort = await listen(target);

    const proxy = track(tls.createServer({
      key: certs.private,
      cert: certs.cert,
      ALPNProtocols: ["http/1.1"],
    }, (socket) => {
      let request = "";
      socket.on("data", function onData(chunk) {
        request += chunk.toString("latin1");
        if (!request.includes("\r\n\r\n")) return;
        socket.off("data", onData);
        const upstream = net.connect({ host: "127.0.0.1", port: targetPort }, () => {
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          socket.pipe(upstream).pipe(socket);
        });
      });
    }));
    const proxyPort = await listen(proxy);

    const output = await runTrustedClient(`
      import { connectHttp2 } from ${JSON.stringify(helperUrl)};
      const client = await connectHttp2(${JSON.stringify(`https://localhost:${targetPort}/`)}, {
        proxyUrl: ${JSON.stringify(`https://localhost:${proxyPort}`)}, timeoutMs: 2000,
      });
      const req = client.request({ ":path": "/" });
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      await new Promise((resolve, reject) => { req.on("end", resolve); req.on("error", reject); req.end(); });
      client.close();
      console.log(body);
    `);

    expect(output).toBe("ok");
  });

  it("keeps a local SOCKS tunnel alive beyond the agent setup timeout", async () => {
    const target = track(http2.createSecureServer({ key: certs.private, cert: certs.cert }));
    target.on("stream", (stream) => {
      stream.on("error", () => {});
      setTimeout(() => { if (!stream.destroyed) { stream.respond({ ":status": 200 }); stream.end("socks-ok"); } }, 800);
    });
    const targetPort = await listen(target);
    let destination;
    const proxy = track(net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      let greeted = false;
      socket.on("data", function onData(chunk) {
        buf = Buffer.concat([buf, chunk]);
        if (!greeted) {
          if (buf.length < 2 || buf.length < 2 + buf[1]) return;
          buf = buf.subarray(2 + buf[1]);
          greeted = true;
          socket.write(Buffer.from([5, 0]));
        }
        if (buf.length < 5) return;
        const size = buf[3] === 3 ? 7 + buf[4] : 10;
        if (buf.length < size) return;
        destination = buf.subarray(5, size - 2).toString();
        const port = buf.readUInt16BE(size - 2);
        socket.off("data", onData);
        const upstream = net.connect({ host: "127.0.0.1", port }, () => {
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (buf.length > size) upstream.write(buf.subarray(size));
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
      });
    }));
    const proxyPort = await listen(proxy);
    const output = await runTrustedClient(`
      import { connectHttp2 } from ${JSON.stringify(helperUrl)};
      const client = await connectHttp2(${JSON.stringify(`https://localhost:${targetPort}/`)}, {
        proxyUrl: ${JSON.stringify(`socks5h://127.0.0.1:${proxyPort}`)}, timeoutMs: 400,
      });
      const req = client.request({ ":path": "/" });
      let body = "";
      req.setEncoding("utf8");
      req.on("data", chunk => { body += chunk; });
      await new Promise((resolve, reject) => { req.on("end", resolve); req.on("error", reject); req.end(); });
      client.close();
      console.log(body);
    `);
    expect(output).toBe("socks-ok");
    expect(destination).toBe("localhost");
  });

  it("rejects a local SOCKS handshake timeout without an uncaught cleanup error", async () => {
    const proxy = track(net.createServer(() => {}));
    const proxyPort = await listen(proxy);
    await expect(connectHttp2("https://localhost/", {
      proxyUrl: `socks5h://127.0.0.1:${proxyPort}`, timeoutMs: 100,
    })).rejects.toThrow(/timed out/i);
  });

  it("rejects an untrusted HTTPS proxy certificate", async () => {
    const proxy = track(tls.createServer({ key: certs.private, cert: certs.cert }));
    const proxyPort = await listen(proxy);

    await expect(connectHttp2("https://localhost:443/", {
      proxyUrl: `https://localhost:${proxyPort}`,
      timeoutMs: 500,
    })).rejects.toThrow(/certificate|issuer|self-signed/i);
  });

  it("does not send proxy credentials in plaintext to an HTTPS proxy", async () => {
    let wire = Buffer.alloc(0);
    const proxy = track(net.createServer((socket) => {
      socket.once("data", (chunk) => {
        wire = chunk;
        socket.destroy();
      });
    }));
    const proxyPort = await listen(proxy);

    await expect(connectHttp2("https://localhost:443/", {
      proxyUrl: `https://user:secret@localhost:${proxyPort}`,
      timeoutMs: 500,
    })).rejects.toThrow();

    expect(wire[0]).toBe(0x16);
    expect(wire.toString("latin1")).not.toContain("Proxy-Authorization");
  });

  it("sends decoded credentials in the CONNECT authorization header", async () => {
    let received = "";
    const proxy = connectProxyServer((socket, request) => {
      received = request;
      socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
    });
    const port = await listen(proxy);
    await expect(connectHttp2("https://localhost/", {
      proxyUrl: `http://user:p%40ss@127.0.0.1:${port}`, timeoutMs: 500,
    })).rejects.toThrow(/407/);
    expect(received).toContain(`Proxy-Authorization: Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  it("rejects when the proxy closes before completing headers", async () => {
    const proxy = track(net.createServer((socket) => socket.end()));
    const proxyPort = await listen(proxy);
    const started = Date.now();

    await expect(connectHttp2("https://localhost:443/", {
      proxyUrl: `http://localhost:${proxyPort}`,
      timeoutMs: 2000,
    })).rejects.toThrow(/closed|ended/i);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("rejects oversized CONNECT response headers", async () => {
    const proxy = connectProxyServer((socket) => {
      socket.write(`HTTP/1.1 200 Connection Established\r\nX-Fill: ${"a".repeat(70 * 1024)}`);
    });
    const proxyPort = await listen(proxy);

    await expect(connectHttp2("https://localhost:443/", {
      proxyUrl: `http://localhost:${proxyPort}`,
      timeoutMs: 1000,
    })).rejects.toThrow(/headers.*large/i);
  });

  it("rejects unsupported proxy protocols before opening a socket", async () => {
    await expect(connectHttp2("https://localhost:443/", {
      proxyUrl: "ftp://user:secret@localhost:21",
      timeoutMs: 500,
    })).rejects.toThrow(/unsupported proxy protocol/i);
  });

  it("rejects a tunneled TLS peer that does not negotiate h2", async () => {
    const target = track(tls.createServer({
      key: certs.private,
      cert: certs.cert,
    }));
    target.on("tlsClientError", () => {});
    const targetPort = await listen(target);
    const proxy = connectProxyServer((socket) => {
      const upstream = net.connect({ host: "127.0.0.1", port: targetPort }, () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        socket.pipe(upstream).pipe(socket);
      });
    });
    const proxyPort = await listen(proxy);

    await expect(runTrustedClient(`
      import { connectHttp2 } from ${JSON.stringify(helperUrl)};
      await connectHttp2(${JSON.stringify(`https://localhost:${targetPort}/`)}, {
        proxyUrl: ${JSON.stringify(`http://localhost:${proxyPort}`)}, timeoutMs: 1000,
      });
    `)).rejects.toThrow(/h2|ALPN/i);
  });
});

describe("Cursor catalog model selection", () => {
  it("keeps exact catalog IDs and only strips variants when the base is usable", async () => {
    const { resolveRequestedModel } = await import("../../open-sse/executors/cursor.js");
    expect(resolveRequestedModel("gpt-5-high", null, new Set(["gpt-5-high"])))
      .toEqual({ modelId: "gpt-5-high", parameters: [] });
    expect(resolveRequestedModel("gpt-5-high-thinking", null, new Set(["gpt-5"])))
      .toEqual({ modelId: "gpt-5", parameters: [{ id: "thinking", value: "true" }, { id: "reasoning", value: "high" }] });
    expect(resolveRequestedModel("gpt-5-high-thinking", null, new Set()))
      .toEqual({ modelId: "gpt-5-high-thinking", parameters: [] });
  });
});
