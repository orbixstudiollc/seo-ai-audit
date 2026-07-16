"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth/client";

export function SignOutButton() {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    await signOut();
    // Clear any cached authed RSC payloads, then leave the gated area.
    router.refresh();
    router.push("/login");
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      className="font-mono text-[11px] uppercase tracking-[0.15em] text-foreground/60 underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none disabled:opacity-50"
    >
      {isSigningOut ? "Signing out…" : "Sign out"}
    </button>
  );
}
