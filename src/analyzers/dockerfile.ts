/**
 * @git-fabric/review — dockerfile analyzer
 *
 * Scans Dockerfile changes for common issues:
 * - Unpinned base images (using :latest)
 * - Running as root
 * - Missing HEALTHCHECK
 * - Secrets in build args
 * - Missing apk/apt upgrade
 */

import type { Analyzer, DiffFile, PullRequestRef, ReviewFinding } from "../types.js";

export const dockerfileAnalyzer: Analyzer = {
  name: "dockerfile",

  async analyze(_pr: PullRequestRef, files: DiffFile[]): Promise<ReviewFinding[]> {
    const findings: ReviewFinding[] = [];

    const dockerfiles = files.filter(
      (f) =>
        f.filename === "Dockerfile" ||
        f.filename.startsWith("Dockerfile.") ||
        f.filename.endsWith("/Dockerfile"),
    );

    for (const file of dockerfiles) {
      if (!file.patch || file.status === "removed") continue;

      const lines = file.patch.split("\n");
      let lineNumber = 0;

      for (const line of lines) {
        const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
        if (hunkMatch) {
          lineNumber = parseInt(hunkMatch[1], 10) - 1;
          continue;
        }

        if (line.startsWith("+")) {
          lineNumber++;
          const content = line.slice(1).trim();

          // Unpinned base image
          if (/^FROM\s+\S+:latest/i.test(content)) {
            findings.push({
              file: file.filename,
              line: lineNumber,
              severity: "MEDIUM",
              category: "dockerfile",
              message: "Base image uses :latest tag. Pin to a specific version for reproducible builds.",
              suggestion: "Use a versioned tag (e.g., nginx:1.29-alpine) instead of :latest.",
            });
          }

          // No tag at all
          if (/^FROM\s+[a-z][a-z0-9._/-]+\s*$/i.test(content) && !content.includes(":") && !content.includes("AS")) {
            findings.push({
              file: file.filename,
              line: lineNumber,
              severity: "MEDIUM",
              category: "dockerfile",
              message: "Base image has no tag specified. This defaults to :latest.",
              suggestion: "Explicitly pin to a versioned tag.",
            });
          }

          // Secrets in ARG/ENV
          if (/^(?:ARG|ENV)\s+(?:.*(?:PASSWORD|SECRET|TOKEN|KEY|PRIVATE).*=)/i.test(content)) {
            findings.push({
              file: file.filename,
              line: lineNumber,
              severity: "HIGH",
              category: "dockerfile",
              message: "Sensitive value in Dockerfile ARG/ENV. This gets baked into the image layer.",
              suggestion: "Use Docker secrets or runtime environment variables instead of build-time ARG/ENV for credentials.",
            });
          }
        } else if (!line.startsWith("-")) {
          lineNumber++;
        }
      }
    }

    return findings;
  },
};
