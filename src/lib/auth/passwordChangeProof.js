import crypto from "node:crypto";

const PROOF_TTL_MS = 5 * 60 * 1000;
const MAX_PROOFS = 500;

// proof -> { clientIp, expiresAt, reserved }
const proofs = new Map();
// clientIp -> active proof (one live proof per IP; a new issue invalidates the prior)
const activeByIp = new Map();
let reservedProof = null;

function sweep(now) {
  for (const [proof, entry] of proofs) {
    if (!entry.reserved && entry.expiresAt < now) {
      proofs.delete(proof);
      if (activeByIp.get(entry.clientIp) === proof) {
        activeByIp.delete(entry.clientIp);
      }
    }
  }
}

function evictOldest() {
  for (const [proof, entry] of proofs) {
    if (entry.reserved) continue;
    proofs.delete(proof);
    if (activeByIp.get(entry.clientIp) === proof) {
      activeByIp.delete(entry.clientIp);
    }
    return true;
  }
  return false;
}

export function issuePasswordChangeProof(clientIp, passwordSessionEpoch = "initial") {
  const now = Date.now();
  sweep(now);

  // A reserved proof belongs to an in-flight password write. Replacing it
  // would allow a second proof to race that write.
  const prior = activeByIp.get(clientIp);
  if (prior) {
    const entry = proofs.get(prior);
    if (entry?.reserved) return null;
    proofs.delete(prior);
  }
  while (proofs.size >= MAX_PROOFS && evictOldest()) {}
  if (proofs.size >= MAX_PROOFS) return null;

  const proof = crypto.randomBytes(32).toString("base64url");
  proofs.set(proof, { clientIp, expiresAt: now + PROOF_TTL_MS, passwordSessionEpoch, reserved: false });
  activeByIp.set(clientIp, proof);
  return proof;
}

function findValid(proof, clientIp, now) {
  const entry = proofs.get(proof);
  if (!entry || entry.clientIp !== clientIp || entry.expiresAt < now || entry.reserved) {
    return null;
  }
  return entry;
}

export function consumePasswordChangeProof(proof, clientIp) {
  const now = Date.now();
  const entry = findValid(proof, clientIp, now);
  if (!entry) return false;
  proofs.delete(proof);
  if (activeByIp.get(clientIp) === proof) activeByIp.delete(clientIp);
  return true;
}
export function reservePasswordChangeProof(proof, clientIp) {
  if (reservedProof && reservedProof !== proof) return null;
  const entry = findValid(proof, clientIp, Date.now());
  if (!entry) return null;
  entry.reserved = true;
  reservedProof = proof;
  return entry;
}

export function commitPasswordChangeProof(proof) {
  if (reservedProof !== proof) return false;
  const entry = proofs.get(proof);
  if (!entry?.reserved) return false;
  proofs.delete(proof);
  if (activeByIp.get(entry.clientIp) === proof) activeByIp.delete(entry.clientIp);
  reservedProof = null;
  return true;
}

export function releasePasswordChangeProof(proof) {
  if (reservedProof !== proof) return false;
  const entry = proofs.get(proof);
  if (!entry?.reserved) return false;
  entry.reserved = false;
  reservedProof = null;
  return true;
}

export function resetPasswordChangeProofs() {
  proofs.clear();
  activeByIp.clear();
  reservedProof = null;
}
