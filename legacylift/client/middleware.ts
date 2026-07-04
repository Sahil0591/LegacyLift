import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { clerkEnabled, hasConfiguredValue } from "./lib/authMode";

const isProtectedRoute = createRouteMatcher([
  "/demo(.*)",
  "/project(.*)",
  "/projects(.*)",
  "/user(.*)",
  "/api/analyze(.*)",
]);

const protectedMiddleware = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect();
});

function demoMiddleware(_req: NextRequest) {
  return NextResponse.next();
}

const clerkMiddlewareEnabled =
  clerkEnabled && hasConfiguredValue(process.env.CLERK_SECRET_KEY);

export default clerkMiddlewareEnabled ? protectedMiddleware : demoMiddleware;

export const config = {
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
