import crypto from "node:crypto";

const PROOF_TTL_MS = 5 * 60 * 1000;
const MAX_PROOFS = 500;

// proof -> { clientIp, expiresAt, reserved }
const proofs = new Map();
// clientIp -> active proof (one live proof per IP; a new issue invalidates the prior)
const activeByIp = new Map();

function sweep(now) {
  for (const [proof, entry] of proofs) {
    if (entry.expiresAt < now) {
      proofs.delete(proof);
      if (activeByIp.get(entry.clientIp) === proof) {
        activeByIp.delete(entry.clientIp);
      }
    }
  }
}

function evictOldest() {
  const oldest = proofs.keys().next().value;
  if (oldest === undefined) return;
  const entry = proofs.get(oldest);
  proofs.delete(oldest);
  if (entry && activeByIp.get(entry.clientIp) === oldest) {
    activeByIp.delete(entry.clientIp);
  }
}

export function issuePasswordChangeProof(clientIp) {
  const now = Date.now();
  sweep(now);

  // Only one active proof per IP: replacing invalidates the prior.
  const prior = activeByIp.get(clientIp);
  if (prior) proofs.delete(prior);

  while (proofs.size >= MAX_PROOFS) evictOldest();

  const proof = crypto.randomBytes(32).toString("base64url");
  proofs.set(proof, { clientIp, expiresAt: now + PROOF_TTL_MS, reserved: false });
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

// Atomically reserves a valid proof so it can't be raced by a sibling
// request while the caller performs a fallible write (e.g. hashing +
// persisting a new password). Returns the entry, or null if the proof
// is missing, mismatched, expired, or already reserved.
export function reservePasswordChangeProof(proof, clientIp) {
  const now = Date.now();
  const entry = findValid(proof, clientIp, now);
  if (!entry) return null;
  entry.reserved = true;
  return entry;
}

// Commits a reservation: permanently consumes the proof after a
// successful write.
export function commitPasswordChangeProof(proof) {
  const entry = proofs.get(proof);
  if (!entry) return;
  proofs.delete(proof);
  if (activeByIp.get(entry.clientIp) === proof) activeByIp.delete(entry.clientIp);
}

// Releases a reservation after a failed write so the proof remains
// usable for a retry instead of being silently destroyed.
export function releasePasswordChangeProof(proof) {
  const entry = proofs.get(proof);
  if (entry) entry.reserved = false;
}

export function resetPasswordChangeProofs() {
  proofs.clear();
  activeByIp.clear();
}
