import crypto from "node:crypto";

const PROOF_TTL_MS = 5 * 60 * 1000;
const proofs = new Map();

export function issuePasswordChangeProof(clientIp) {
  const proof = crypto.randomBytes(32).toString("base64url");
  proofs.set(proof, { clientIp, expiresAt: Date.now() + PROOF_TTL_MS });
  return proof;
}

export function consumePasswordChangeProof(proof, clientIp) {
  const entry = proofs.get(proof);
  proofs.delete(proof);
  return Boolean(entry && entry.clientIp === clientIp && entry.expiresAt >= Date.now());
}

export function resetPasswordChangeProofs() {
  proofs.clear();
}
