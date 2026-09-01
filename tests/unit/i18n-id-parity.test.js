import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const literalsDir = resolve(__dirname, "../../public/i18n/literals");
const load = (name) => JSON.parse(readFileSync(resolve(literalsDir, name), "utf8"));
const en = load("en.json");
const id = load("id.json");

const REVIEWED_TRANSLATIONS = {
  "2. DurinDoor Hub": "2. Hub DurinDoor",
  "DurinDoor (Entry)": "DurinDoor (Entri)",
  "DurinDoor Base URL": "URL Dasar DurinDoor",
  "How DurinDoor Works": "Cara Kerja DurinDoor",
  "Install DurinDoor": "Instal DurinDoor",
  "Starting DurinDoor...": "Memulai DurinDoor...",
  "Update DurinDoor": "Perbarui DurinDoor",
  "Deploying... (may take ~1 min)": "Mendeploy... (mungkin perlu ~1 menit)",
  "Manage reusable per-connection proxies and bind them to provider connections.":
    "Kelola proxy per koneksi yang dapat digunakan kembali dan kaitkan ke koneksi penyedia.",
  "Expose your local DurinDoor to the internet. No port forwarding, no static IP needed. Share endpoint URL with your team or use it in Cursor, Cline, and other AI tools from anywhere.":
    "Jadikan DurinDoor lokal Anda dapat diakses melalui internet. Tidak perlu penerusan port atau IP statis. Bagikan URL endpoint kepada tim Anda atau gunakan di Cursor, Cline, dan alat AI lainnya dari mana saja.",
  "yet.": "saat ini.",
  "Round Robin": "Round Robin",
  "Sticky Limit": "Sticky Limit",
  "Endpoint is exposed without an API key.": "Titik akhir terekspos tanpa kunci API.",
  "OIDC login is currently active. Password login is disabled until you switch back.":
    "Login OIDC saat ini aktif. Login kata sandi dinonaktifkan sampai Anda beralih kembali.",
  "Open Claude Desktop → Help → Troubleshooting → Enable Developer mode → Configure third-party inference, then return here.":
    "Buka Claude Desktop → Bantuan → Pemecahan Masalah → Aktifkan mode Pengembang → Konfigurasi inferensi pihak ketiga, lalu kembali ke sini.",
  "Connect to providers with OAuth to track your API quota limits and usage.":
    "Hubungkan ke penyedia dengan OAuth untuk melacak batas kuota API dan penggunaan Anda.",
  "Usage by API Key": "Penggunaan per Kunci API",
  "Track and manage your API quota limits": "Lacak dan kelola batas kuota API Anda",
  "⚠️ MITM intercepts HTTPS traffic of IDE tools (Antigravity, GitHub Copilot, Kiro) via local CA to redirect requests to your providers. May violate ToS → account ban. Use at your own risk.":
    "⚠️ MITM mencegat lalu lintas HTTPS alat IDE (Antigravity, GitHub Copilot, Kiro) melalui CA lokal untuk mengalihkan permintaan ke penyedia Anda. Mungkin melanggar ToS → risiko pemblokiran akun. Gunakan dengan risiko Anda sendiri.",
};

const STALE_UPSTREAM_KEYS = [
  "2. 9Router Hub",
  "9Router (Entry)",
  "9Router Base URL",
  "How 9Router Works",
  "Install 9Router",
  "Starting 9Router...",
  "Update 9Router",
];

const COMPATIBILITY_KEYS = [
  "Configure 9router as an OpenAI-compatible provider to route all jcode requests through 9router's optimization layer.",
  "Manual configuration is still available if 9router is deployed on a remote server.",
  "npm install -g 9router",
  "npx 9router",
  "sk_9router (default)",
];

describe("i18n id key parity (upstream #3666)", () => {
  it("matches the canonical English key set exactly", () => {
    expect(Object.keys(id).sort()).toEqual(Object.keys(en).sort());
  });

  it("has a non-empty Indonesian string for every key", () => {
    for (const [key, value] of Object.entries(id)) {
      expect(typeof value, `key: ${key}`).toBe("string");
      expect(value.trim().length, `key: ${key}`).toBeGreaterThan(0);
    }
  });

  it("locks reviewed shipped translations and corrected defects", () => {
    for (const [source, translated] of Object.entries(REVIEWED_TRANSLATIONS)) {
      expect(id[source], source).toBe(translated);
    }
  });

  it("drops stale product keys while retaining canonical compatibility identifiers", () => {
    for (const key of STALE_UPSTREAM_KEYS) expect(id).not.toHaveProperty(key);
    for (const key of COMPATIBILITY_KEYS) {
      expect(Object.hasOwn(en, key), key).toBe(true);
      expect(Object.hasOwn(id, key), key).toBe(true);
    }
  });
});
