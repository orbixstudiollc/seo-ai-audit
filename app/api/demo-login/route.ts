import { NextResponse } from "next/server";
import { seedDemoUser } from "@/lib/dev/demoUser";

// Browser-navigable "Try the demo" button target. Same E2E_PGLITE=1-only
// gating as app/api/test/seed/route.ts (404 in any real deployment) and the
// same underlying seedDemoUser() — this route just redirects into the app
// with the Set-Cookie header attached to a real 302, instead of returning
// JSON for a test harness to relay. A plain <a href="/api/demo-login"> is
// enough: the browser stores the cookie and follows the redirect in one hop.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  if (process.env.E2E_PGLITE !== "1") {
    return new Response("Not found", { status: 404 });
  }

  let cookies: string[];
  try {
    ({ cookies } = await seedDemoUser());
  } catch {
    return NextResponse.redirect(new URL("/login?demoError=1", request.url));
  }

  const response = NextResponse.redirect(new URL("/app", request.url));
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}
