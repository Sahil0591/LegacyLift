import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";

// ── WAITLIST MODE ────────────────────────────────────────────────────────────
// The whole product is temporarily gated behind the waitlist landing at "/".
// Every other route (demo, projects, sign-in, api, ...) redirects there so
// nothing half-finished is reachable while the launch post is live.
//
// To restore the full app, revert this file to the route-protection version in
// git history (the `createRouteMatcher` + `auth.protect()` block).
// Only the waitlist landing ("/") and its Neon fallback API ("/api/waitlist")
// are reachable; everything else redirects to the landing.
const ALLOWED = new Set(["/", "/api/waitlist"]);

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (!ALLOWED.has(pathname)) {
    return NextResponse.redirect(new URL("/", req.url));
  }
});

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
