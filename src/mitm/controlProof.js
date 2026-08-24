import { isString } from "@/shared/utils/typeChecks.js";const crypto = require("crypto");

const CONTROL_SECRET_ENV = "DURINDOOR_CONTROL_PROOF_SECRET";
const CONTROL_PROOF_HEADER = "x-9r-owner-proof";
const CONTROL_PORT_HEADER = "x-9r-owner-port";

function normalizeMethod(method) {
  return String(method || "GET").toUpperCase();
}

function normalizePathname(value) {
  try {
    return new URL(String(value || "/"), "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function normalizePort(port) {
  const value = Number(port);
  return Number.isSafeInteger(value) && value > 0 && value <= 65535 ? value : null;
}

function proofPayload({ method, pathname, remotePort }) {
  const port = normalizePort(remotePort);
  if (!port) return null;
  return `${normalizeMethod(method)}\n${normalizePathname(pathname)}\n${port}`;
}

function isValidSecret(secret) {
  return isString(secret) && /^[a-f0-9]{64,128}$/i.test(secret);
}

function createControlProof({ method, pathname, remotePort, secret = process.env[CONTROL_SECRET_ENV] }) {
  const payload = proofPayload({ method, pathname, remotePort });
  if (!payload || !isValidSecret(secret)) return null;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function verifyControlProof({ method, pathname, remotePort, proof, secret = process.env[CONTROL_SECRET_ENV] }) {
  if (!/^[a-f0-9]{64}$/i.test(String(proof || ""))) return false;
  const expected = createControlProof({ method, pathname, remotePort, secret });
  if (!expected) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(proof), "hex"));
}

module.exports = {
  CONTROL_PORT_HEADER,
  CONTROL_PROOF_HEADER,
  CONTROL_SECRET_ENV,
  createControlProof,
  verifyControlProof
};