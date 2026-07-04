// lib/github.ts — fetch legacy source files from a public GitHub repo
// (server-side, used by /api/analyze). Best-effort and capped so a giant repo
// can't stall the request. Optionally uses GITHUB_TOKEN for a higher rate limit.

import type { InputFile } from "@/lib/analyze";

const CODE_EXT = /\.(cbl|cob|cobol|cpy|jcl|java)$/i;
const MAX_FILES = 25;
const MAX_BYTES = 200_000;

export class GithubError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "GithubError";
    this.status = status;
  }
}

interface TreeNode {
  path: string;
  type: string;
  size?: number;
}

export function parseRepo(
  url: string,
): { owner: string; repo: string } | null {
  const m = url
    .trim()
    .match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

export async function fetchRepoFiles(
  url: string,
): Promise<{ files: InputFile[]; repo: string }> {
  const parsed = parseRepo(url);
  if (!parsed) throw new GithubError("That doesn't look like a GitHub repo URL.", 400);
  const { owner, repo } = parsed;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const repoRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    { headers },
  );
  if (repoRes.status === 404) {
    throw new GithubError("Repo not found — is it public?", 404);
  }
  if (repoRes.status === 403) {
    throw new GithubError(
      "GitHub rate limit hit. Add a GITHUB_TOKEN or upload files instead.",
      429,
    );
  }
  if (!repoRes.ok) {
    throw new GithubError(`GitHub API error ${repoRes.status}.`, repoRes.status);
  }
  const repoData = (await repoRes.json()) as { default_branch?: string };
  const branch = repoData.default_branch ?? "main";

  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers },
  );
  if (!treeRes.ok) {
    throw new GithubError(
      `Couldn't read the repo file tree (${treeRes.status}).`,
      treeRes.status,
    );
  }
  const tree = (await treeRes.json()) as { tree?: TreeNode[] };

  const blobs = (tree.tree ?? [])
    .filter(
      (n) =>
        n.type === "blob" &&
        CODE_EXT.test(n.path) &&
        (n.size ?? 0) <= MAX_BYTES,
    )
    .slice(0, MAX_FILES);

  if (blobs.length === 0) {
    throw new GithubError(
      "No COBOL or Java files (.cbl/.cob/.cpy/.jcl/.java) found in that repo.",
      422,
    );
  }

  const files: InputFile[] = [];
  for (const blob of blobs) {
    const raw = await fetch(
      `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${blob.path}`,
    );
    if (raw.ok) {
      files.push({
        filename: blob.path.split("/").pop() ?? blob.path,
        content: await raw.text(),
      });
    }
  }

  if (files.length === 0) {
    throw new GithubError("Couldn't download any files from that repo.", 502);
  }
  return { files, repo: `${owner}/${repo}` };
}
