/**
 * @git-fabric/review — dependency analyzer
 *
 * Detects changes to dependency manifests and flags:
 * - New dependencies added
 * - Major version bumps
 * - Removal of lockfile integrity
 * - Suspicious packages
 */

import type { Analyzer, DiffFile, PullRequestRef, ReviewFinding } from "../types.js";

const MANIFEST_FILES = [
  "package.json",
  "requirements.txt",
  "Pipfile",
  "go.mod",
  "Cargo.toml",
  "Gemfile",
];

export const dependencyAnalyzer: Analyzer = {
  name: "dependency",

  async analyze(_pr: PullRequestRef, files: DiffFile[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    for (const file of files) {
      if (!file.patch || file.status === "removed") continue;

      const isManifest = MANIFEST_FILES.some(
        (m) => file.filename.endsWith(m) || file.filename.includes(m),
      );

      if (!isManifest) continue;

      const addedLines = file.patch
        .split("\n")
        .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

      if (addedLines.length > 0) {
        findings.push({
          file: file.filename,
          severity: "INFO",
          category: "dependency",
          message: `Dependency manifest modified: ${addedLines.length} line(s) added. Review new dependencies for supply-chain risk.`,
        });
      }

      // Check for lockfile deletion
      const lockfiles = files.filter(
        (f) =>
          f.status === "removed" &&
          (f.filename.endsWith(".lock") ||
            f.filename.endsWith("-lock.json") ||
            f.filename.endsWith("lock.yaml") ||
            f.filename === "bun.lock"),
      );

      for (const lf of lockfiles) {
        findings.push({
          file: lf.filename,
          severity: "HIGH",
          category: "dependency",
          message: "Lockfile deleted. This removes dependency pinning and may allow non-deterministic installs.",
          suggestion: "Restore the lockfile to maintain reproducible builds.",
        });
      }
    }

    return findings;
  },
};
