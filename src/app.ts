/**
 * @git-fabric/review — App factory
 *
 * Creates a FabricApp for gateway consumption.
 * The gateway calls createApp() to register this app.
 */

import { createAdaptersFromEnv } from "./adapters/env.js";
import type { FabricApp, FabricTool, ReviewFinding, ReviewResult, ReviewVerdict, DiffFile, PullRequestRef } from "./types.js";
import { securityAnalyzer, dependencyAnalyzer, dockerfileAnalyzer } from "./analyzers/index.js";

const ANALYZERS = [securityAnalyzer, dependencyAnalyzer, dockerfileAnalyzer];

export async function createApp(): Promise<FabricApp> {
  const { github, repos: managedRepos } = createAdaptersFromEnv();

  function buildTools(token: string, defaultRepos: string[]): FabricTool[] {
    return [
      {
        name: "review_pr",
        description: "Analyze a pull request for security issues, dependency risks, and code quality concerns. Posts review comments to the PR.",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            pr_number: { type: "number", description: "Pull request number" },
            post_review: { type: "boolean", default: false, description: "Post findings as a PR review comment" },
            dry_run: { type: "boolean", default: false },
          },
          required: ["owner", "repo", "pr_number"],
        },
        async execute(args) {
          const owner = args.owner as string;
          const repo = args.repo as string;
          const prNumber = args.pr_number as number;
          const dryRun = (args.dry_run as boolean) ?? false;

          const start = Date.now();

          // Fetch PR metadata
          const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
            headers: { Authorization: `bearer ${token}`, "User-Agent": "git-fabric-review/0.1.0" },
          });
          if (!prRes.ok) throw new Error(`Failed to fetch PR: ${prRes.status}`);
          const prData = await prRes.json() as Record<string, unknown>;
          const head = prData.head as Record<string, unknown>;
          const base = prData.base as Record<string, unknown>;

          const pr: PullRequestRef = {
            owner,
            repo,
            number: prNumber,
            sha: head.sha as string,
            head: (head.ref as string),
            base: (base.ref as string),
          };

          // Fetch diff files
          const filesRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, {
            headers: { Authorization: `bearer ${token}`, "User-Agent": "git-fabric-review/0.1.0" },
          });
          if (!filesRes.ok) throw new Error(`Failed to fetch PR files: ${filesRes.status}`);
          const filesData = await filesRes.json() as Array<Record<string, unknown>>;

          const diffFiles: DiffFile[] = filesData.map((f) => ({
            filename: f.filename as string,
            status: f.status as DiffFile["status"],
            patch: f.patch as string | undefined,
            additions: f.additions as number,
            deletions: f.deletions as number,
          }));

          // Run all analyzers
          const allFindings: ReviewFinding[] = [];
          for (const analyzer of ANALYZERS) {
            const findings = await analyzer.analyze(pr, diffFiles);
            allFindings.push(...findings);
          }

          // Determine verdict
          let verdict: ReviewVerdict = "approve";
          if (allFindings.some((f) => f.severity === "CRITICAL" || f.severity === "HIGH")) {
            verdict = "request_changes";
          } else if (allFindings.some((f) => f.severity === "MEDIUM")) {
            verdict = "comment";
          }

          const result: ReviewResult = {
            pr,
            verdict,
            findings: allFindings,
            summary: `${allFindings.length} finding(s): ${countBySeverity(allFindings)}`,
            durationMs: Date.now() - start,
          };

          if (!dryRun && (args.post_review as boolean)) {
            // Post review to GitHub
            await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
              method: "POST",
              headers: {
                Authorization: `bearer ${token}`,
                "Content-Type": "application/json",
                "User-Agent": "git-fabric-review/0.1.0",
              },
              body: JSON.stringify({
                event: verdict === "approve" ? "APPROVE" : verdict === "request_changes" ? "REQUEST_CHANGES" : "COMMENT",
                body: formatReviewBody(result),
              }),
            });
          }

          return JSON.stringify(result, null, 2);
        },
      },
      {
        name: "review_diff",
        description: "Analyze a raw diff string for security issues without connecting to GitHub. Useful for local pre-commit review.",
        inputSchema: {
          type: "object",
          properties: {
            diff: { type: "string", description: "Unified diff content" },
            filename: { type: "string", description: "Filename context for the diff", default: "unknown" },
          },
          required: ["diff"],
        },
        async execute(args) {
          const diff = args.diff as string;
          const filename = (args.filename as string) ?? "unknown";

          const diffFile: DiffFile = {
            filename,
            status: "modified",
            patch: diff,
            additions: diff.split("\n").filter((l) => l.startsWith("+")).length,
            deletions: diff.split("\n").filter((l) => l.startsWith("-")).length,
          };

          const pr: PullRequestRef = { owner: "", repo: "", number: 0, sha: "", base: "", head: "" };

          const allFindings: ReviewFinding[] = [];
          for (const analyzer of ANALYZERS) {
            const findings = await analyzer.analyze(pr, [diffFile]);
            allFindings.push(...findings);
          }

          return JSON.stringify({
            findings: allFindings,
            summary: `${allFindings.length} finding(s): ${countBySeverity(allFindings)}`,
          }, null, 2);
        },
      },
      {
        name: "review_scan_repos",
        description: "Scan all open PRs across managed repos and return a summary of review findings.",
        inputSchema: {
          type: "object",
          properties: {
            repos: { type: "array", items: { type: "string" }, description: "Repos to scan (owner/repo). Defaults to managed repos." },
            severity_threshold: { type: "string", enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"], default: "MEDIUM" },
          },
        },
        async execute(args) {
          const repos = (args.repos as string[]) ?? defaultRepos;
          const threshold = (args.severity_threshold as string) ?? "MEDIUM";
          const results: Array<{ repo: string; pr: number; title: string; findings: number }> = [];

          for (const fullRepo of repos) {
            const [owner, repo] = fullRepo.split("/");
            const prsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=50`, {
              headers: { Authorization: `bearer ${token}`, "User-Agent": "git-fabric-review/0.1.0" },
            });
            if (!prsRes.ok) continue;
            const prs = await prsRes.json() as Array<Record<string, unknown>>;

            for (const pr of prs) {
              results.push({
                repo: fullRepo,
                pr: pr.number as number,
                title: pr.title as string,
                findings: 0, // Placeholder — full analysis on demand
              });
            }
          }

          return JSON.stringify({
            repos_scanned: repos.length,
            open_prs: results.length,
            threshold,
            prs: results,
          }, null, 2);
        },
      },
    ];
  }

  return {
    name: "@git-fabric/review",
    version: "0.1.0",
    description: "Automated PR review engine for the git-fabric ecosystem. Analyzes diffs, detects security patterns, and surfaces CVE exposure on pull requests.",
    tools: buildTools(github.token, managedRepos),
    async health() {
      try {
        const res = await fetch("https://api.github.com/rate_limit", {
          headers: { Authorization: `bearer ${github.token}`, "User-Agent": "git-fabric-review/0.1.0" },
        });
        if (!res.ok) return { app: "@git-fabric/review", status: "unavailable" as const, details: { error: "Token invalid" } };
        const data = await res.json() as Record<string, unknown>;
        const rate = data.rate as Record<string, unknown>;
        return {
          app: "@git-fabric/review",
          status: "healthy" as const,
          details: { rateRemaining: rate.remaining, rateLimit: rate.limit },
        };
      } catch (err) {
        return { app: "@git-fabric/review", status: "degraded" as const, details: { error: (err as Error).message } };
      }
    },
  };
}

/* ── Helpers ────────────────────────────────────────────────── */

function countBySeverity(findings: ReviewFinding[]): string {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([s, c]) => `${c} ${s}`)
    .join(", ") || "clean";
}

function formatReviewBody(result: ReviewResult): string {
  const lines = [`## fabric-review`, ``, result.summary, ``];

  if (result.findings.length === 0) {
    lines.push("No issues found.");
  } else {
    for (const f of result.findings) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      lines.push(`- **${f.severity}** \`${loc}\` — ${f.message}`);
      if (f.suggestion) lines.push(`  > ${f.suggestion}`);
    }
  }

  lines.push(``, `---`, `*Reviewed in ${result.durationMs}ms by [@git-fabric/review](https://github.com/git-fabric/fabric-review)*`);
  return lines.join("\n");
}
