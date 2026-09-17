import { pathToFileURL } from "node:url";
import { readFile, access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Path prefixes treated as internal (not required to be reachable from README.md).
 * Empty after `docs/superpowers/` agent plan/spec trees were removed from the repo.
 */
export const INTERNAL_PREFIXES = [];

export const INTERNAL_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "open-sse/AGENT-INDEX.md",
  "tests/README.md",
]);

export const COMMUNITY_FILES = new Set([
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  ".github/CONTRIBUTING.md",
  ".github/SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/CHANGELOG_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.md",
  ".github/ISSUE_TEMPLATE/feature_request.md",
]);

export const PACKAGE_FILES = new Set([
  "cli/README.md",
  "skills/README.md",
  "skills/durindoor/SKILL.md",
  "skills/durindoor-chat/SKILL.md",
  "skills/durindoor-embeddings/SKILL.md",
  "skills/durindoor-image/SKILL.md",
  "skills/durindoor-stt/SKILL.md",
  "skills/durindoor-tts/SKILL.md",
  "skills/durindoor-web-fetch/SKILL.md",
  "skills/durindoor-web-search/SKILL.md",
]);

export const REQUIRED_ASSETS = [
  "durindoor-banner.png",
  "durindoor-wordmark-theme-aware.svg",
];

export const FORBIDDEN_PUBLIC_TEXT = [
  "bloodf.github.io/durindoor",
  "https://9router.com",
];

/** Task 12 section stub body. Dangling meta pages and missing description are skipped while this remains. */
export const SECTION_STUB_BODY = "Pages in this section are being written.";

const EMOJI_RE = /[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u;
const EM_DASH = "\u2014";

export function githubSlug(value) {
  let s = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "" : s;
}

function posixRel(p) {
  return p.split(path.sep).join("/");
}

export function isDocFile(file) {
  return file.endsWith(".md") || file.endsWith(".mdx");
}

export function isDocsMdx(file) {
  return file.startsWith("docs/") && file.endsWith(".mdx");
}

export function isDocsLegacyMd(file) {
  return file.startsWith("docs/") && file.endsWith(".md");
}

export function isRootMd(file) {
  return file.endsWith(".md") && !file.includes("/");
}

export function stripCodeBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const fenceMatch = lines[i].match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (fenceMatch) {
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      i++;
      while (i < lines.length) {
        const closeMatch = lines[i].match(/^(\s{0,3})(`{3,}|~{3,})/);
        if (closeMatch && closeMatch[2][0] === fenceChar && closeMatch[2].length >= fenceLen) {
          i++;
          break;
        }
        i++;
      }
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join("\n").replace(/`[^`]*`/g, "");
}

/**
 * Drop YAML frontmatter and MDX component trees (PascalCase tags) so `#` inside
 * `<Cards>` / `<Callout>` is not treated as a heading.
 */
export function stripMdxConstructs(text) {
  let body = text;
  if (body.startsWith("---\n") || body.startsWith("---\r\n")) {
    const start = body.startsWith("---\r\n") ? 5 : 4;
    const rest = body.slice(start);
    const endMatch = rest.match(/\r?\n---\r?\n/);
    if (endMatch) {
      body = rest.slice(endMatch.index + endMatch[0].length);
    }
  }
  const lines = body.split("\n");
  const out = [];
  let i = 0;
  const openRe = /^\s*<([A-Z][A-Za-z0-9.]*)\b/;
  while (i < lines.length) {
    const m = lines[i].match(openRe);
    if (m) {
      const tag = m[1];
      const line = lines[i];
      if (/\/>\s*$/.test(line) || new RegExp(`</${tag}>\\s*$`).test(line)) {
        i++;
        continue;
      }
      i++;
      const close = new RegExp(`^\\s*</${tag}>\\s*$`);
      while (i < lines.length && !close.test(lines[i])) i++;
      if (i < lines.length) i++;
      continue;
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
}

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return null;
  const start = text.startsWith("---\r\n") ? 5 : 4;
  const rest = text.slice(start);
  const endMatch = rest.match(/\r?\n---(?:\r?\n|$)/);
  if (!endMatch) return null;
  const yaml = rest.slice(0, endMatch.index);
  const fields = {};
  for (const line of yaml.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      v = v.slice(1, -1);
    }
    fields[m[1]] = v;
  }
  return fields;
}

export function bodyAfterFrontmatter(text) {
  if (!text.startsWith("---\n") && !text.startsWith("---\r\n")) return text;
  const start = text.startsWith("---\r\n") ? 5 : 4;
  const rest = text.slice(start);
  const endMatch = rest.match(/\r?\n---(?:\r?\n|$)/);
  if (!endMatch) return text;
  return rest.slice(endMatch.index + endMatch[0].length);
}

export function isSectionStub(text) {
  if (!text) return false;
  return bodyAfterFrontmatter(text).trim() === SECTION_STUB_BODY;
}

function* linksIn(source, text) {
  for (const match of text.matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)) {
    yield { file: source, raw: match[2].trim() };
  }
  for (const match of text.matchAll(/<(?:img|a)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
    yield { file: source, raw: match[1].trim() };
  }
}

function resolveLink(fromFile, raw) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  if (raw.startsWith("#")) return { target: fromFile, anchor: raw.slice(1) };
  const [beforeHash, hash] = raw.split("#");
  const resolved = posixRel(path.normalize(path.join(path.dirname(fromFile), beforeHash)));
  return { target: resolved, anchor: hash };
}

function headingsFor(text) {
  const counts = new Map();
  const ids = new Set();
  const prepared = stripMdxConstructs(text);
  for (const line of prepared.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.+)$/);
    if (!m) continue;
    const slug = githubSlug(m[1]);
    const count = counts.get(slug) || 0;
    counts.set(slug, count + 1);
    ids.add(count === 0 ? slug : `${slug}-${count}`);
  }
  return ids;
}

const isPublic = (file) => {
  if (INTERNAL_FILES.has(file) || COMMUNITY_FILES.has(file) || PACKAGE_FILES.has(file)) return false;
  for (const prefix of INTERNAL_PREFIXES) if (file.startsWith(prefix)) return false;
  return true;
};

function skipMetaPage(entry) {
  // meta.json is parsed JSON; anything that is not already a string is not a page name.
  if (String(entry) !== entry) return true;
  if (entry === "---") return true;
  if (entry.startsWith("...") || entry.startsWith("!")) return true;
  if (entry.startsWith("[")) return true;
  return false;
}

async function pathIsDir(root, rel) {
  try {
    const st = await stat(path.join(root, rel));
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function pathIsFile(root, rel) {
  try {
    const st = await stat(path.join(root, rel));
    return st.isFile();
  } catch {
    return false;
  }
}

async function walkMetaJson({
  root,
  dirRel,
  fileSet,
  contents,
  read,
  reachableMdx,
  issues,
}) {
  const metaRel = posixRel(path.join(dirRel, "meta.json"));
  let raw;
  try {
    raw = await readFile(path.join(root, metaRel), "utf8");
  } catch {
    if (dirRel === "docs") return;
    issues.push(`${metaRel}: missing or invalid meta.json`);
    return;
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    issues.push(`${metaRel}: missing or invalid meta.json`);
    return;
  }
  const pages = Array.isArray(meta.pages) ? meta.pages : [];
  const pageNames = new Set();
  const indexRel = posixRel(path.join(dirRel, "index.mdx"));
  let indexText = contents[indexRel];
  if (indexText === undefined) {
    try {
      indexText = await read(indexRel);
    } catch {
      indexText = "";
    }
  }
  const stubSection = isSectionStub(indexText);

  for (const entry of pages) {
    if (skipMetaPage(entry)) continue;
    pageNames.add(entry);
    const mdxRel = posixRel(path.join(dirRel, `${entry}.mdx`));
    const folderRel = posixRel(path.join(dirRel, entry));
    const hasMdx = fileSet.has(mdxRel) || await pathIsFile(root, mdxRel);
    const hasFolder = await pathIsDir(root, folderRel);
    if (hasMdx) reachableMdx.add(mdxRel);
    if (hasFolder) {
      await walkMetaJson({
        root,
        dirRel: folderRel,
        fileSet,
        contents,
        read,
        reachableMdx,
        issues,
      });
    }
    if (!hasMdx && !hasFolder && !stubSection) {
      issues.push(`${metaRel}: dangling pages entry '${entry}'`);
    }
  }

  for (const file of fileSet) {
    if (!file.endsWith(".mdx")) continue;
    if (posixRel(path.dirname(file)) !== dirRel) continue;
    const base = path.basename(file, ".mdx");
    if (file === "docs/index.mdx") continue;
    if (!pageNames.has(base)) {
      issues.push(`${file}: not listed in ${metaRel} pages`);
    }
  }
}

export async function validateDocumentation({ root, files, readText }) {
  const read = readText || (async (p) => readFile(path.join(root, p), "utf8"));
  const fileSet = new Set(files);
  const issues = [];
  const contents = Object.create(null);
  const stripped = Object.create(null);
  const headings = Object.create(null);
  const links = [];
  const docFiles = files.filter(isDocFile);

  for (const file of docFiles) {
    const original = await read(file);
    contents[file] = original;
    stripped[file] = stripCodeBlocks(original);
    headings[file] = headingsFor(stripped[file]);
  }

  for (const file of docFiles) {
    const text = contents[file];
    const rendered = stripped[file];

    if (file === "README.md") {
      for (const asset of REQUIRED_ASSETS) {
        if (!text.includes(asset)) {
          issues.push(`${file}: missing ${asset}`);
        }
      }
    }

    if (isPublic(file)) {
      for (const forbidden of FORBIDDEN_PUBLIC_TEXT) {
        if (text.includes(forbidden)) {
          issues.push(`${file}: forbidden URL ${forbidden}`);
        }
      }
    }

    if (isDocsMdx(file)) {
      const fm = parseFrontmatter(text);
      const stub = isSectionStub(text);
      if (!fm || !fm.title) {
        issues.push(`${file}: missing frontmatter title`);
      }
      if (!stub && (!fm || !fm.description)) {
        issues.push(`${file}: missing frontmatter description`);
      }
      if (rendered.includes(EM_DASH)) {
        issues.push(`${file}: em dash (U+2014) outside code fences`);
      }
      if (EMOJI_RE.test(rendered)) {
        issues.push(`${file}: emoji outside code fences`);
      }
      // Fumadocs only resolves page links that start with ./ or ../
      for (const m of rendered.matchAll(/\]\((?!\.{1,2}\/|\/|https?:|#|mailto:)([^)\s]+\.mdx)/g)) {
        issues.push(`${file}: bare relative link ${m[1]} (prefix with ./)`);
      }
    }

    const checkLinks = !isDocsLegacyMd(file) || file === "docs/README.md";
    if (checkLinks) {
      for (const link of linksIn(file, rendered)) {
        const resolved = resolveLink(file, link.raw);
        if (!resolved) continue;
        links.push({ from: file, ...resolved });
      }
    }
  }

  for (const { from, target, anchor } of links) {
    const existsAsDoc = fileSet.has(target);
    let existsAsFile = false;
    if (!existsAsDoc) {
      try {
        await access(path.join(root, target), constants.F_OK);
        existsAsFile = true;
      } catch {
        existsAsFile = false;
      }
    }
    if (!existsAsDoc && !existsAsFile) {
      issues.push(`${from}: missing target ${target}`);
      continue;
    }
    if (existsAsDoc && anchor !== undefined && anchor !== "") {
      let anchorSlug;
      try {
        anchorSlug = githubSlug(decodeURIComponent(anchor));
      } catch {
        anchorSlug = githubSlug(anchor);
      }
      if (!headings[target].has(anchorSlug)) {
        issues.push(`${from}: missing anchor #${anchorSlug} in ${target}`);
      }
    }
  }

  for (const file of docFiles) {
    const text = contents[file];
    for (const match of text.matchAll(/`npm run ([a-z:][a-zA-Z0-9:-]*)`/g)) {
      const script = match[1];
      try {
        const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
        if (!pkg.scripts || !pkg.scripts[script]) {
          issues.push(`${file}: documented npm script '${script}' not found in package.json`);
        }
      } catch {
        // package.json unreadable — skip script validation.
      }
    }
  }

  for (const required of COMMUNITY_FILES) {
    if (!fileSet.has(required)) {
      issues.push(`repository: missing required community file ${required}`);
    }
  }

  const docsMdx = docFiles.filter(isDocsMdx);
  const reachableMdx = new Set();
  if (fileSet.has("docs/index.mdx")) reachableMdx.add("docs/index.mdx");
  if (docsMdx.length) {
    await walkMetaJson({
      root,
      dirRel: "docs",
      fileSet,
      contents,
      read,
      reachableMdx,
      issues,
    });
  }

  const reachableRoot = new Set();
  const rootStarts = ["README.md", "docs/README.md"].filter((f) => fileSet.has(f));
  const stack = [...rootStarts];
  while (stack.length) {
    const current = stack.pop();
    if (reachableRoot.has(current)) continue;
    reachableRoot.add(current);
    for (const link of links) {
      if (link.from === current && fileSet.has(link.target)) {
        stack.push(link.target);
      }
    }
  }

  for (const file of docFiles) {
    if (!isPublic(file)) continue;
    if (isDocsMdx(file)) {
      if (!reachableMdx.has(file)) {
        issues.push(`${file}: public document is not reachable from docs/index.mdx through meta.json`);
      }
      continue;
    }
    if (isDocsLegacyMd(file)) continue;
    if (isRootMd(file) && !reachableRoot.has(file)) {
      issues.push(`${file}: public document is not reachable from README.md`);
    }
  }

  issues.sort();
  return issues;
}

export async function validateRepository(cwd) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--", "*.md", "*.mdx"], { cwd });
  const files = stdout
    ? stdout.split("\0").filter((f) => f !== "" && (f.endsWith(".md") || f.endsWith(".mdx")))
    : [];
  return validateDocumentation({ root: cwd, files });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = await validateRepository(process.cwd());
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else {
    console.log("Documentation integrity checks passed.");
  }
}
