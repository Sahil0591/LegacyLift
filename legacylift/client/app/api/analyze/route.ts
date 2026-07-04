// app/api/analyze/route.ts - POST: ingest uploaded files or a public GitHub
// repo, identify legacy code units, and score risk with deterministic rules.
// Body: { files?: { filename, content }[] } OR { repoUrl }.

import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { analyzeFiles, type InputFile } from "@/lib/analyze";
import { clerkEnabled, hasConfiguredValue } from "@/lib/authMode";
import { fetchRepoFiles, GithubError } from "@/lib/github";
import { rateLimit } from "@/lib/rateLimit";

const serverAuthEnabled =
  clerkEnabled && hasConfiguredValue(process.env.CLERK_SECRET_KEY);

export async function POST(req: Request) {
  // Defense-in-depth: middleware already gates /api/analyze, but enforce here
  // too so the handler can't run unauthenticated if the matcher ever drifts.
  const userId = serverAuthEnabled ? (await auth()).userId : "local-demo";
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Key the limiter by the authenticated user rather than a spoofable IP.
  const rl = rateLimit(`analyze:${userId}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many analyses - try again in ${rl.retryAfter}s.` },
      { status: 429 },
    );
  }

  let body: { files?: InputFile[]; repoUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    let files: InputFile[] = [];
    let projectName = "uploaded-project";
    let source = "upload";

    if (body.repoUrl && body.repoUrl.trim()) {
      const res = await fetchRepoFiles(body.repoUrl);
      files = res.files;
      projectName = res.repo;
      source = `github:${res.repo}`;
    } else if (Array.isArray(body.files) && body.files.length > 0) {
      files = body.files.filter(
        (f) =>
          f &&
          typeof f.filename === "string" &&
          typeof f.content === "string",
      );
      projectName =
        files[0]?.filename?.replace(/\.[^.]+$/, "") ?? "uploaded-project";
    } else {
      return NextResponse.json(
        { error: "Provide files[] or a repoUrl." },
        { status: 400 },
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No readable source files were provided." },
        { status: 400 },
      );
    }

    const result = analyzeFiles(files, { projectName, source });
    if (result.chunks.length === 0) {
      return NextResponse.json(
        { error: "Couldn't identify any code units in those files." },
        { status: 422 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof GithubError ? err.status : 500;
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status },
    );
  }
}
