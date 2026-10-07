// Keep historical public filenames on the canonical DurinDoor identity.
import { createRequire } from "node:module";
import { readFile, writeFile, copyFile } from "node:fs/promises";
const require = createRequire(new URL("../website/package.json", import.meta.url));
const sharp = require("sharp");
const light = await readFile("assets/brand/durindoor-logo-light.svg", "utf8");
const dark = await readFile("assets/brand/durindoor-logo-dark.svg", "utf8");
await writeFile("assets/durindoor-wordmark.svg", dark);
const adaptive = light.replace('<g fill="#14291E">', '<g class="wordmark" fill="currentColor" color="#14291E">').replace(/<svg([^>]*)>/, '<svg$1><style>@media(prefers-color-scheme:dark){.wordmark{color:#EEEAE4}}</style>');
await writeFile("assets/durindoor-wordmark-theme-aware.svg", adaptive);
for (const [filename, source, background] of [
  ["durindoor-wordmark.png", dark],
  ["durindoor-wordmark-light.png", light],
  ["durindoor-wordmark-compact.png", dark],
  ["durindoor-wordmark-card.png", dark, "#0c1410"],
  ["durindoor-wordmark-universal.png", dark, "#0c1410"],
]) {
  let image = sharp(Buffer.from(source)).resize({ width: 1365 });
  if (background) image = image.flatten({ background });
  await image.png().toFile(`assets/${filename}`);
}
await copyFile("assets/brand/durindoor-social.png", "assets/durindoor-banner.png");
await copyFile("assets/durindoor-wordmark.png", "public/durindoor-wordmark.png");
console.log("Canonical identity synchronized to project assets.");
