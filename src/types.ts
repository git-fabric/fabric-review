/**
 * @git-fabric/review — shared types
 *
 * All layers import from here. No circular dependencies.
 */

/* ── FabricApp contract ─────────────────────────────────────── */

export interface FabricTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface FabricApp {
  name: string;
  version: string;
  description: string;
  tools: FabricTool[];
  health: () => Promise<HealthStatus>;
}

export interface HealthStatus {
  app: string;
  status: "healthy" | "degraded" | "unavailable";
  latencyMs?: number;
  details?: Record<string, unknown>;
}

/* ── Review domain ──────────────────────────────────────────── */

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type ReviewVerdict = "approve" | "request_changes" | "comment";

export interface ReviewFinding {
  file: string;
  line?: number;
  severity: Severity;
  category: FindingCategory;
  message: string;
  suggestion?: string;
}

export type FindingCategory =
  | "security"
  | "dependency"
  | "dockerfile"
  | "quality"
  | "secret"
  | "cve";

export interface ReviewResult {
  pr: PullRequestRef;
  verdict: ReviewVerdict;
  findings: ReviewFinding[];
  summary: string;
  durationMs: number;
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  sha: string;
  base: string;
  head: string;
}

/* ── Analyzer contract ──────────────────────────────────────── */

export interface Analyzer {
  name: string;
  analyze: (pr: PullRequestRef, files: DiffFile[]) => Promise<ReviewFinding[]>;
}

export interface DiffFile {
  filename: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  additions: number;
  deletions: number;
}
