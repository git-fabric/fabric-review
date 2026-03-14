/**
 * @git-fabric/review — environment adapter
 *
 * Constructs API clients and config from environment variables.
 */

export interface ReviewAdapters {
  github: { token: string };
  repos: string[];
  stateRepo: string | null;
}

export function createAdaptersFromEnv(): ReviewAdapters {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required");
  }

  const reposRaw = process.env.MANAGED_REPOS ?? "";
  const repos = reposRaw
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);

  const stateRepo = process.env.STATE_REPO ?? null;

  return { github: { token }, repos, stateRepo };
}
