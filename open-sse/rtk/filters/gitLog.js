// JS-native git-log filter
// Compresses `git log` output: keeps commit headers, subjects, Author/Date;
// drops body padding, decoration, embedded diff lines.
import { GIT_LOG_MAX_LINES } from "../constants.js";

export function gitLog(text, maxLines = GIT_LOG_MAX_LINES) {
  if (!text) return "";

  const input = String(text);
  const lines = input.split("\n");
  const out = [];
  let skipped = 0;
  let omitted = false;      inCommit = true;
      subjectSeen = false;
      pushLine(line);
      continue;
    }

    if (inCommit) {
      // Author / Date — keep as-is (already column 0 in raw, or graph-prefix stripped by commit-header match)
      if (/^[*|/\\ ]*(Author|AuthorDate|Commit|CommitDate|Date):/i.test(trimmed)) {        pushLine(trimmed);
        continue;
      }
      // blank — skip
      if (trimmed === "") {
        omitted = true;
        continue;
      }      // indented subject (4 spaces, optionally preceded by graph decoration) — first one is subject
      if (!subjectSeen && /^[*|/\\ ]*    \S/.test(line)) {
        pushLine("  Subject: " + trimmed);
        subjectSeen = true;
        continue;
      }
      // stat summary: "N file(s) changed, N insertions(+), N deletions(-)"
      // `git log --graph --stat` prefixes this with graph columns such as "|  ".
      const graphStripped = trimmed.replace(/^[*|/\\ ]+/, "");
      if (/^\d+ file\w* changed/.test(graphStripped)) {
        pushLine("  " + graphStripped);
        continue;
      }
      // file-level stat rows from `git log --stat` / `--numstat`:
      // "src/a.js | 3 ++" or "4\t0\tsrc/a.js".
      if (isStatFileLine(graphStripped)) {
        pushLine("  " + graphStripped);
        continue;
      }
      // name-only / name-status entries: "src/a.js" or "M\tsrc/a.js"
      if (isNameOnlyPath(graphStripped) || isNameStatusLine(graphStripped)) {
        pushLine("  " + graphStripped);        continue;
      }
      // embedded diff header — one-line marker
      if (/^diff --git /.test(trimmed)) {
        pushLine("  ... diff body omitted");
        omitted = true;
        continue;
      }
      // everything else in commit body — drop
      omitted = true;      continue;
    }

    // Not in a commit block (--oneline / --graph modes):

    // Graph decoration + sha + subject: "*|/\\ <sha7> <subject>"
    const graphMatch = trimmed.match(/^[*|/\\ ]+([0-9a-f]{7,40}\s+.+)/i);
    if (graphMatch) {
      pushLine(graphMatch[1]);
      continue;
    }

    // Plain oneline: "<sha7> <subject>"
    if (/^[0-9a-f]{7,40}\s+/.test(trimmed)) {
      pushLine(trimmed);
      continue;
    }

    // Pure graph decoration (no sha) — drop
    if (/^[*|/\\ ]+$/.test(trimmed) && /[*|/\\]/.test(trimmed)) {
      omitted = true;gitLog.filterName = "git-log";
