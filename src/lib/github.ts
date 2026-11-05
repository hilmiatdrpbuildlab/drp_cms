import "server-only";

import { CONTENT_ROOT } from "./blog/contract";
import { getEnv } from "./env";

/**
 * Commits to drp_compro through the GitHub Git Data API: every file of a publish lands in ONE commit,
 * so the site's build never sees an article without its images.
 *
 * A fine-grained token can't be limited to a folder, so the folder rule is enforced here: any path
 * outside content/blog/ throws before a request is made. Protect the rest of the repo with a
 * CODEOWNERS/ruleset on the GitHub side as well (see README).
 */

export type FileChange = { path: string; content: Uint8Array | string } | { path: string; delete: true };

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function assertContentPath(path: string) {
  if (!path.startsWith(CONTENT_ROOT) || path.includes("..") || path.includes("\\") || path.includes("//")) {
    throw new GitHubError(`Refusing to write outside ${CONTENT_ROOT}: ${path}`);
  }
}

function config() {
  const env = getEnv();
  if (!env.GITHUB_TOKEN) throw new GitHubError("GITHUB_TOKEN is not set, so the CMS cannot publish. See README.md.");
  return { token: env.GITHUB_TOKEN, repo: env.GITHUB_REPO, branch: env.GITHUB_BRANCH };
}

async function gh<T>(path: string, init: RequestInit & { allow404?: boolean } = {}): Promise<T | null> {
  const { token, repo } = config();
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "drp-cms",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
  if (res.status === 404 && init.allow404) return null;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GitHubError(`GitHub ${init.method ?? "GET"} ${path} failed: ${res.status} ${detail.slice(0, 300)}`, res.status);
  }
  return res.status === 204 ? null : ((await res.json()) as T);
}

export type WorkflowRun = {
  status: "queued" | "in_progress" | "completed" | string;
  conclusion: "success" | "failure" | "cancelled" | "skipped" | string | null;
  url: string;
  startedAt: string | null;
  updatedAt: string;
};

/**
 * The site rebuild (GitHub Action) a commit started, or null if none has been queued yet.
 * Needs the token's "Actions: read" permission; without it this returns "forbidden".
 */
export async function getWorkflowRun(sha: string): Promise<WorkflowRun | null | "forbidden"> {
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  try {
    const res = await gh<{
      workflow_runs: { name: string; status: string; conclusion: string | null; html_url: string; run_started_at: string | null; updated_at: string; event: string }[];
    }>(`/actions/runs?head_sha=${sha}&per_page=5`);
    // drp_compro's .github/workflows/blog.yml is named "Blog"; fall back to any push run.
    const runs = res?.workflow_runs ?? [];
    const run = runs.find((r) => r.name === "Blog") ?? runs.find((r) => r.event === "push");
    return run
      ? { status: run.status, conclusion: run.conclusion, url: run.html_url, startedAt: run.run_started_at, updatedAt: run.updated_at }
      : null;
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 401 || e.status === 403 || e.status === 404)) return "forbidden";
    throw e;
  }
}

/** Files directly inside a directory on the publish branch ([] if it doesn't exist). */
export async function listFiles(dir: string): Promise<string[]> {
  assertContentPath(dir);
  const { branch } = config();
  const items = await gh<{ type: string; path: string }[]>(
    `/contents/${encodeURI(dir.replace(/\/$/, ""))}?ref=${encodeURIComponent(branch)}`,
    { allow404: true },
  );
  return Array.isArray(items) ? items.filter((i) => i.type === "file").map((i) => i.path) : [];
}

export async function fileExists(path: string): Promise<boolean> {
  assertContentPath(path);
  const { branch } = config();
  return (await gh(`/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`, { allow404: true })) !== null;
}

/**
 * One commit with all changes. Deleting a path that doesn't exist is dropped rather than failing.
 * Retries once if someone else pushed to the branch in between.
 */
export async function commitFiles(
  changes: FileChange[],
  message: string,
  author: { name: string; email: string },
): Promise<{ sha: string; url: string }> {
  changes.forEach((c) => assertContentPath(c.path));
  const { repo, branch } = config();

  // Blobs don't depend on the branch head, so upload them once.
  const writes = await Promise.all(
    changes
      .filter((c): c is Extract<FileChange, { content: unknown }> => "content" in c)
      .map(async (c) => {
        const content = typeof c.content === "string" ? Buffer.from(c.content, "utf8") : Buffer.from(c.content);
        const blob = await gh<{ sha: string }>("/git/blobs", {
          method: "POST",
          body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
        });
        return { path: c.path, mode: "100644", type: "blob", sha: blob!.sha };
      }),
  );
  const deletes = changes.filter((c) => "delete" in c).map((c) => c.path);

  for (let attempt = 0; ; attempt++) {
    const ref = await gh<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const head = ref!.object.sha;
    const commit = await gh<{ tree: { sha: string } }>(`/git/commits/${head}`);

    // GitHub rejects a tree entry deleting a path that isn't there, so only delete what exists.
    const existing = await Promise.all(deletes.map(async (p) => ((await fileExists(p)) ? p : null)));
    const tree = [
      ...writes,
      ...existing.filter((p): p is string => p !== null).map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
    ];
    if (!tree.length) throw new GitHubError("Nothing to commit.");

    const newTree = await gh<{ sha: string }>("/git/trees", {
      method: "POST",
      body: JSON.stringify({ base_tree: commit!.tree.sha, tree }),
    });
    const now = new Date().toISOString();
    const newCommit = await gh<{ sha: string }>("/git/commits", {
      method: "POST",
      body: JSON.stringify({ message, tree: newTree!.sha, parents: [head], author: { ...author, date: now } }),
    });
    try {
      await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha: newCommit!.sha, force: false }),
      });
      return { sha: newCommit!.sha, url: `https://github.com/${repo}/commit/${newCommit!.sha}` };
    } catch (e) {
      // 422 = not a fast-forward: the branch moved while we were building the commit.
      if (e instanceof GitHubError && e.status === 422 && attempt === 0) continue;
      throw e;
    }
  }
}
