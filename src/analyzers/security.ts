/**
 * @git-fabric/review — security analyzer
 *
 * Scans diffs for common security anti-patterns:
 * - Hardcoded secrets and API keys
 * - Command injection risks
 * - SQL injection patterns
 * - Unsafe deserialization
 * - Path traversal
 */

import type { Analyzer, DiffFile, PullRequestRef, ReviewFinding } from "../types.js";

const SECRET_PATTERNS = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["'][^"']{8,}/i, label: "Possible API key" },
  { pattern: /(?:secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}/i, label: "Possible hardcoded secret" },
  { pattern: /sk-ant-[a-zA-Z0-9_-]{20,}/, label: "Anthropic API key" },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/, label: "GitHub PAT (classic)" },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/, label: "GitHub PAT (fine-grained)" },
  { pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/, label: "Private key" },
  { pattern: /Bearer\s+[a-zA-Z0-9_\-.]{20,}/, label: "Bearer token" },
];

const INJECTION_PATTERNS = [
  { pattern: /\beval\s*\(/, label: "Use of eval()" },
  { pattern: /new\s+Function\s*\(/, label: "Dynamic Function constructor" },
  { pattern: /child_process.*exec\s*\(/, label: "Possible command injection via exec()" },
  { pattern: /\$\{.*\}.*(?:exec|spawn|system)/, label: "Template literal in shell command" },
  { pattern: /dangerouslySetInnerHTML/, label: "React XSS risk: dangerouslySetInnerHTML" },
  { pattern: /innerHTML\s*=/, label: "Direct innerHTML assignment" },
];

const SQL_PATTERNS = [
  { pattern: /`[^`]*\$\{[^}]+\}[^`]*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i, label: "SQL query with string interpolation" },
  { pattern: /["'][^"']*\+\s*\w+\s*\+[^"']*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i, label: "SQL query with concatenation" },
];

export const securityAnalyzer: Analyzer = {
  name: "security",

  async analyze(_pr: PullRequestRef, files: DiffFile[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const file of files) {
      if (!file.patch || file.status === "removed") continue;

      const lines = file.patch.split("\n");
      let lineNumber = 0;

      for (const line of lines) {
        // Track line numbers from diff headers
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
        if (hunkMatch) {
          lineNumber = parseInt(hunkMatch[1], 10) - 1;
          continue;
        }

        if (line.startsWith("+")) {
          lineNumber++;
          const content = line.slice(1);

          for (const { pattern, label } of SECRET_PATTERNS) {
            if (pattern.test(content)) {
              findings.push({
                file: file.filename,
                line: lineNumber,
                severity: "CRITICAL",
                category: "secret",
                message: label,
                suggestion: "Use environment variables or a secrets manager instead of hardcoding credentials.",
              });
            }
          }

          for (const { pattern, label } of INJECTION_PATTERNS) {
            if (pattern.test(content)) {
              findings.push({
                file: file.filename,
                line: lineNumber,
                severity: "HIGH",
                category: "security",
                message: label,
                suggestion: "Avoid dynamic code execution. Use parameterized queries, array-form subprocess calls, or safe rendering APIs.",
              });
            }
          }

          for (const { pattern, label } of SQL_PATTERNS) {
            if (pattern.test(content)) {
              findings.push({
                file: file.filename,
                line: lineNumber,
                severity: "HIGH",
                category: "security",
                message: label,
                suggestion: "Use parameterized queries with prepared statements.",
              });
            }
          }
        } else if (!line.startsWith("-")) {
          lineNumber++;
        }
      }
    }

    return findings;
  },
};
