import { SignupForm } from "./SignupForm";

/**
 * Server component so the page can see whether Google OAuth is actually
 * configured — the "Continue with Google" button is hidden (not dead) when
 * the env vars are absent.
 */
export default function SignupPage() {
  const showGoogle = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return <SignupForm showGoogle={showGoogle} />;
}
