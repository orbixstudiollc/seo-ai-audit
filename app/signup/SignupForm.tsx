"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp, signIn } from "../../lib/auth/client";

export function SignupForm({ showGoogle }: { showGoogle: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: signUpError } = await signUp.email({ name, email, password });

    setIsSubmitting(false);

    if (signUpError) {
      setError(signUpError.message || "Could not sign up.");
      return;
    }

    router.push("/app");
  }

  async function handleGoogleSignIn() {
    setError(null);
    const { error: googleError } = await signIn.social({
      provider: "google",
      callbackURL: "/app",
    });

    if (googleError) {
      setError(googleError.message || "Google sign-in is unavailable.");
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-surface-0 px-4 py-16 font-sans text-text-1">
      <div className="w-full max-w-sm">
        <p className="flex items-baseline gap-2">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 translate-y-px bg-accent-ink"
          />
          <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.2em]">
            AEO/GEO Optimizer
          </span>
        </p>

        <div className="mt-5 border border-line bg-surface-1 p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
                Name
              </span>
              <input
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="border border-line-strong bg-surface-1 px-3 py-2 text-sm text-text-1 focus-visible:border-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
                Email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="border border-line-strong bg-surface-1 px-3 py-2 text-sm text-text-1 focus-visible:border-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[11px] uppercase tracking-widest text-text-3">
                Password
              </span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="border border-line-strong bg-surface-1 px-3 py-2 text-sm text-text-1 focus-visible:border-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
              />
            </label>

            {error ? <p className="text-sm text-score-weak">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 bg-text-1 px-5 py-2.5 text-sm font-semibold uppercase tracking-wide text-surface-1 transition-colors hover:bg-accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Signing up…" : "Sign up"}
            </button>
          </form>

          {showGoogle ? (
            <>
              <div className="mt-5 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest text-text-3">
                <span className="h-px flex-1 bg-line" />
                or
                <span className="h-px flex-1 bg-line" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="mt-5 w-full border border-line-strong px-4 py-2.5 text-sm font-medium text-text-2 transition-colors hover:border-text-3 hover:text-text-1 focus-visible:border-accent-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
              >
                Continue with Google
              </button>
            </>
          ) : null}
        </div>

        <p className="mt-5 flex items-baseline justify-between gap-3 text-sm text-text-2">
          Already have an account?
          <Link
            href="/login"
            className="font-mono text-xs uppercase tracking-wider text-accent-ink underline underline-offset-4 transition-colors hover:text-text-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-ink"
          >
            Log in &rarr;
          </Link>
        </p>
      </div>
    </div>
  );
}
