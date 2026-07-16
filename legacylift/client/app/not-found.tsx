import { redirect } from "next/navigation";

// WAITLIST MODE: any route that would otherwise 404 (e.g. an asset-like dotted
// path that middleware.ts doesn't match) bounces to the waitlist landing instead
// of showing a 404. Normal routes are already redirected in middleware.ts.
// Remove this when restoring the full app.
export default function NotFound() {
  redirect("/");
}
