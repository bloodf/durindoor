import fs from "fs";
import path from "path";
import { randomInt } from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

const TUNNEL_DIR = path.join(DATA_DIR, "tunnel");
const STATE_FILE = path.join(TUNNEL_DIR, "state.json");

const SHORT_ID_LENGTH = 6;
const SHORT_ID_CHARS = "abcdefghijklmnpqrstuvwxyz23456789";

export function ensureTunnelDir() {
  if (!fs.existsSync(TUNNEL_DIR)) fs.mkdirSync(TUNNEL_DIR, { recursive: true });
}

export function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch { /* ignore corrupt state */ }
  return null;
}

export function saveState(state) {
  ensureTunnelDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearState() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch { /* ignore */ }
}

/**
 * Generates the capability-bearing public tunnel subdomain with unbiased OS CSPRNG draws.
 * Length and alphabet stay stable for existing tunnel registration contracts.
 */
export function generateShortId() {
  let result = "";
  for (let i = 0; i < SHORT_ID_LENGTH; i++) {
    result += SHORT_ID_CHARS.charAt(randomInt(0, SHORT_ID_CHARS.length));
  }
  return result;
}

export { TUNNEL_DIR };
