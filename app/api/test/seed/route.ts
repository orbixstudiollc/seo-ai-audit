import { seedDemoUser } from "@/lib/dev/demoUser";

// Test-only seed endpoint for the Playwright e2e. It exists ONLY when the
// dev server is booted with E2E_PGLITE=1 (the Playwright webServer sets it);
// any other environment gets a 404, so it is never reachable in production.
//
// It signs up a fresh user through the REAL Better Auth path (returning genuine
// session cookies, no forged/bypassed session), stores an encrypted BYOK key so
// the audit route's key lookup succeeds, and forwards the Set-Cookie headers so
// the browser context is authenticated for the rest of the journey. The stored
// key's value is never used — AUDIT_TEST_MOCK swaps in a mock model — but it is
// encrypted for real, so the route's decrypt step is exercised too.
//
// See app/api/demo-login/route.ts for the browser-navigable equivalent (a
// redirect instead of JSON) used by the login page's "Try the demo" button.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(): Promise<Response> {
  if (process.env.E2E_PGLITE !== "1") {
    return new Response("Not found", { status: 404 });
  }

  let email: string;
  let cookies: string[];
  try {
    ({ email, cookies } = await seedDemoUser());
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "seed failed" },
      { status: 500 },
    );
  }

  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify({ ok: true, email }), { status: 200, headers });
}
