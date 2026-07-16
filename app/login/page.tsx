import { LoginForm } from "./LoginForm";

/**
 * Server component so the page can see whether Google OAuth is actually
 * configured — the "Continue with Google" button is hidden (not dead) when
 * the env vars are absent. Same reasoning for the demo-login button: only
 * shown in the E2E_PGLITE=1 mock-data mode (see app/api/demo-login), never
 * in a real deployment where that route 404s.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ demoError?: string }>;
}) {
  const showGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  const showDemoLogin = process.env.E2E_PGLITE === "1";
  const demoError = (await searchParams).demoError === "1";
  return <LoginForm showGoogle={showGoogle} showDemoLogin={showDemoLogin} demoError={demoError} />;
}
