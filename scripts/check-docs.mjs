import { pathToFileURL } from "node:url";
import { readFile, access } from "node:fs/promises";
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

export function githubSlug(value) {
  let s = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s/g, "-")
    .replace(/^-+|-+$/g, "");
  return s === "" ? "" : s;
}

function stripCodeBlocks(text) {
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

function* linksIn(source, text) {
  // Markdown inline links and images: [text](url) and ![text](url)
  for (const match of text.matchAll(/!?\[([^\]]*)\]\(([^)]+)\)/g)) {
    yield { file: source, raw: match[2].trim() };
  }
  // HTML <img src="..."> and <a href="...">
  for (const match of text.matchAll(/<(?:img|a)\b[^>]*?\b(?:src|href)=["']([^"']+)["']/gi)) {
    yield { file: source, raw: match[1].trim() };
  }
}

function resolveLink(fromFile, raw) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // scheme or mailto
  if (raw.startsWith("#")) return { target: fromFile, anchor: raw.slice(1) };
  const [beforeHash, hash] = raw.split("#");
  const resolved = path.normalize(path.join(path.dirname(fromFile), beforeHash));
  return { target: resolved, anchor: hash };
}

function headingsFor(text) {
  const counts = new Map();
  const ids = new Set();
  for (const line of text.split("\n")) {
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

export async function validateDocumentation({ root, files, readText }) {
  const read = readText || (async (p) => readFile(path.join(root, p), "utf8"));
  const fileSet = new Set(files);
  const issues = [];
  const contents = Object.create(null);
  const stripped = Object.create(null);
  const headings = Object.create(null);
  const links = [];
  const entryPoints = ["README.md", "docs/README.md"];

  for (const file of files) {
    const original = await read(file);
    contents[file] = original;
    stripped[file] = stripCodeBlocks(original);
    headings[file] = headingsFor(stripped[file]);
  }

  for (const file of files) {
    const text = contents[file];
    const rendered = stripped[file];

    for (const asset of REQUIRED_ASSETS) {
      if (entryPoints.includes(file) && !text.includes(asset)) {
        issues.push(`${file}: missing ${asset}`);
      }
    }

    if (isPublic(file)) {
      for (const forbidden of FORBIDDEN_PUBLIC_TEXT) {
        if (text.includes(forbidden)) {
          issues.push(`${file}: forbidden URL ${forbidden}`);
        }
      }
    }

    for (const link of linksIn(file, rendered)) {
      const resolved = resolveLink(file, link.raw);
      if (!resolved) continue;
      links.push({ from: file, ...resolved });
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

  // Contract #8: documented root npm scripts must exist in package.json.
  for (const file of files) {
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

  // Contract #9: required standard community files must exist.
  for (const required of COMMUNITY_FILES) {
    if (!fileSet.has(required)) {
      issues.push(`repository: missing required community file ${required}`);
    }
  }

  // Reachability from the two public entry points, walking all Markdown links.
  const reachable = new Set();
  const stack = [...entryPoints.filter((f) => fileSet.has(f))];
  while (stack.length) {
    const current = stack.pop();
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const link of links) {
      if (link.from === current && fileSet.has(link.target)) {
        stack.push(link.target);
      }
    }
  }

  for (const file of files) {
    if (isPublic(file) && !reachable.has(file)) {
      issues.push(`${file}: public document is not reachable from README.md or docs/README.md`);
    }
  }

  issues.sort();
  return issues;
}

export async function validateRepository(cwd) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z", "--", "*.md"], { cwd });
  const files = stdout
    ? stdout.split("\0").filter((f) => f !== "" && f.endsWith(".md"))
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
