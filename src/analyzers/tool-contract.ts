/**
 * @git-fabric/review — tool contract analyzer (AI-ADR-013)
 *
 * fabric.resolve reads each tool's effect from MCP annotations and matches
 * intents against tool descriptions, so every added or changed tool must:
 * - carry `annotations` (an unannotated tool is treated as a write)
 * - have a description of at least MIN_DESCRIPTION characters
 *
 * Works from the diff alone: a tool whose object is cut off by the hunk
 * boundary is skipped rather than guessed at.
 */

import type { Analyzer, DiffFile, PullRequestRef, ReviewFinding } from "../types.js";

export const MIN_DESCRIPTION = 20;

const TOOL_NAME = /\bname:\s*['"]([a-z][a-z0-9]*_[a-z0-9_]+)['"]/;
const SOURCE_FILE = /^(?:src|lib)\/.*\.(?:ts|js|mjs)$/;

interface NewLine {
  text: string;
  line: number;
  added: boolean;
}

/** New-side lines of each hunk, with line numbers and whether they were added */
function hunks(patch: string): NewLine[][] {
  const result: NewLine[][] = [];
  let current: NewLine[] | null = null;
  let lineNumber = 0;

  for (const raw of patch.split("\n")) {
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      current = [];
      result.push(current);
      lineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (!current || raw.startsWith("-") || raw.startsWith("\\")) continue;
    current.push({ text: raw.slice(1), line: lineNumber++, added: raw.startsWith("+") });
  }
  return result;
}

/**
 * Lines of the tool object that starts on hunk[start], ending where its braces
 * close; null when the object runs past the end of the hunk.
 */
function toolObject(hunk: NewLine[], start: number): NewLine[] | null {
  let depth = 0;
  for (let i = start; i < hunk.length; i++) {
    let text = hunk[i].text.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "");
    if (i === start) text = text.slice(text.search(/\bname:/));
    for (const ch of text) {
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") {
        if (--depth < 0) return hunk.slice(start, i + 1);
      }
    }
  }
  return null;
}

/** Concatenated string literals of the description, or null if it isn't a literal */
function descriptionText(region: NewLine[]): { text: string; added: boolean } | null {
  const start = region.findIndex((l) => /\bdescription:/.test(l.text));
  if (start === -1) return null;

  const parts: string[] = [];
  let added = false;
  for (let i = start; i < region.length; i++) {
    let text = region[i].text;
    if (i === start) text = text.slice(text.search(/\bdescription:/) + "description:".length);
    else if (/^\s*(?:inputSchema|annotations|execute|async\s+execute)\b/.test(text)) break;
    const head = text.split(/,\s*(?:inputSchema|annotations|execute)\b/)[0];
    const literals = [...head.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`/g)];
    if (literals.length === 0 && i === start && head.trim()) return null; // variable or call
    parts.push(...literals.map((m) => m[1] ?? m[2] ?? m[3]));
    added ||= region[i].added;
    if (head !== text) break;
  }
  return parts.length ? { text: parts.join(""), added } : null;
}

export const toolContractAnalyzer: Analyzer = {
  name: "tool-contract",

  async analyze(_pr: PullRequestRef, files: DiffFile[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const file of files) {
      if (!file.patch || file.status === "removed") continue;
      if (!SOURCE_FILE.test(file.filename) || /\.(?:test|spec)\./.test(file.filename)) continue;

      for (const hunk of hunks(file.patch)) {
        hunk.forEach((l, start) => {
          const match = l.text.match(TOOL_NAME);
          if (!match) return;
          const region = toolObject(hunk, start);
          if (!region || !region.some((r) => r.added)) return;
          if (!region.some((r) => /\bexecute\b/.test(r.text))) return; // not a tool definition
          const name = match[1];

          if (!region.some((l) => /\bannotations\s*:/.test(l.text))) {
            findings.push({
              file: file.filename,
              line: region[0].line,
              severity: "HIGH",
              category: "contract",
              message: `Tool \`${name}\` has no MCP annotations. fabric.resolve treats unannotated tools as writes (AI-ADR-013).`,
              suggestion: "Add `annotations: { readOnlyHint: true }` for reads, or `{ readOnlyHint: false, destructiveHint: <bool> }` for writes.",
            });
          }

          const description = descriptionText(region);
          if (description?.added && description.text.trim().length < MIN_DESCRIPTION) {
            findings.push({
              file: file.filename,
              line: region[0].line,
              severity: "MEDIUM",
              category: "contract",
              message: `Tool \`${name}\` description is ${description.text.trim().length} characters; fabric.resolve matches intents against descriptions and needs at least ${MIN_DESCRIPTION}.`,
              suggestion: "Say what the tool acts on and what it returns or changes.",
            });
          }
        });
      }
    }

    return findings;
  },
};
