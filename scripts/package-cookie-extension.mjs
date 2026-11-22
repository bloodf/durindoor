#!/usr/bin/env node
/**
 * Reproducible local package of the provider cookie capture extension.
 *
 *   node scripts/package-cookie-extension.mjs [--out <dir>] [--check]
 *
 * Writes `durindoor-cookie-capture-<version>.zip` and a `.sha256` file. The zip
 * is deterministic: a fixed file list in sorted order, STORE (no compression, so
 * no zlib-version dependence), fixed 1980-01-01 timestamps and fixed attributes.
 * The same sources give the same bytes on any machine. `--check` builds twice and
 * fails when the two builds differ. Nothing is downloaded and no dependency is used.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32 } from "node:zlib";
import { isMainModule } from "./lib/is-main-module.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const EXTENSION_DIR = path.join(ROOT, "extensions", "provider-cookie-capture");
/** Runtime files only: no README, no tests. */
export const PACKAGE_FILES = Object.freeze(["capture.js", "main.js", "manifest.json", "popup.css", "popup.html", "popup.js", "providers.js", "types.js"]);
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UNIX_FILE_ATTRS = (0o100644 << 16) >>> 0;

function localHeader(name, data, crc) {
  const header = Buffer.alloc(30 + name.length);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(0, 8); // STORE
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  header.write(name, 30, "utf8");
  return header;
}

function centralHeader(name, data, crc, offset) {
  const header = Buffer.alloc(46 + name.length);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, 2.0
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(crc, 16);
  header.writeUInt32LE(data.length, 20);
  header.writeUInt32LE(data.length, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt32LE(UNIX_FILE_ATTRS, 38);
  header.writeUInt32LE(offset, 42);
  header.write(name, 46, "utf8");
  return header;
}

/** @param {{ name: string, data: Buffer }[]} files */
export function buildZip(files) {
  const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of sorted) {
    const crc = crc32(data) >>> 0;
    const local = Buffer.concat([localHeader(name, data, crc), data]);
    centrals.push(centralHeader(name, data, crc, offset));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}

/** Build the package in memory from the extension directory. */
export async function buildPackage(dir = EXTENSION_DIR) {
  const files = await Promise.all(PACKAGE_FILES.map(async (name) => ({ name, data: await readFile(path.join(dir, name)) })));
  const manifest = JSON.parse(files.find((f) => f.name === "manifest.json").data.toString("utf8"));
  const zip = buildZip(files);
  return {
    fileName: `durindoor-cookie-capture-${manifest.version}.zip`,
    version: manifest.version,
    zip,
    sha256: createHash("sha256").update(zip).digest("hex"),
  };
}

async function main(argv) {
  const outIndex = argv.indexOf("--out");
  const outDir = path.resolve(outIndex >= 0 && argv[outIndex + 1] ? argv[outIndex + 1] : path.join(EXTENSION_DIR, "dist"));
  const first = await buildPackage();
  if (argv.includes("--check")) {
    const second = await buildPackage();
    if (first.sha256 !== second.sha256) throw new Error("Package is not reproducible: two builds differ");
  }
  await mkdir(outDir, { recursive: true });
  const target = path.join(outDir, first.fileName);
  await writeFile(target, first.zip);
  await writeFile(`${target}.sha256`, `${first.sha256}  ${first.fileName}\n`);
  process.stdout.write(`${target}\nsha256 ${first.sha256}\n`);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
