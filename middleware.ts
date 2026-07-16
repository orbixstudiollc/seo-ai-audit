import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// First-line gate for the authed dashboard. This is a lightweight cookie
// *presence* check only — it runs on the Edge, never touches the DB, and does
// NOT validate the session (a forged/expired cookie passes here). The
// authoritative server-side check is `auth.api.getSession` in
// `app/app/layout.tsx`, which redirects on any invalid/expired session. Both
// layers are intentional: the cookie check keeps unauthenticated traffic off
// the dashboard cheaply, the layout check is what actually secures it.
export function middleware(request: NextRequest): NextResponse {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

// Only run on the dashboard. Everything else (`/`, `/login`, `/signup`,
// `/api/auth/*`, static assets) is untouched and publicly reachable.
export const config = {
  matcher: ["/app/:path*"],
};
