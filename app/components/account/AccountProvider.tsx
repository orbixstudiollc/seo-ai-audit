"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { accountAuthConfigured, getBrowserSupabase } from "@/lib/auth/client";
import { ACCOUNT_OWNER_CHANGED_EVENT } from "@/lib/auth/events";
import { magicLinkErrorMessage } from "@/lib/auth/messages";
import { CLOUD_OWNER_HEADER, getCloudOwnerToken } from "@/lib/cloud/owner";

type AccountContextValue = {
  configured: boolean;
  loading: boolean;
  email: string | null;
  sendMagicLink: (email: string) => Promise<{ ok: boolean; message: string }>;
  signOut: () => Promise<void>;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const configured = accountAuthConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(configured);
  const linkedToken = useRef<string | null>(null);

  const linkWorkspace = useCallback(async (activeSession: Session) => {
    if (linkedToken.current === activeSession.access_token) return;
    try {
      const response = await fetch("/api/account/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeSession.access_token}`,
          [CLOUD_OWNER_HEADER]: getCloudOwnerToken(window.localStorage),
        },
        cache: "no-store",
      });
      if (!response.ok) return;
      linkedToken.current = activeSession.access_token;
      window.dispatchEvent(new Event(ACCOUNT_OWNER_CHANGED_EVENT));
    } catch { /* Authentication stays usable; workspace linking retries on the next auth event. */ }
  }, []);

  useEffect(() => {
    const client = getBrowserSupabase();
    if (!client) { queueMicrotask(() => setLoading(false)); return; }
    let active = true;
    queueMicrotask(() => {
      void client.auth.getSession().then(({ data }) => {
        if (!active) return;
        setSession(data.session); setLoading(false);
        if (data.session) void linkWorkspace(data.session);
      });
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession); setLoading(false);
      if (nextSession) queueMicrotask(() => { void linkWorkspace(nextSession); });
      else linkedToken.current = null;
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [linkWorkspace]);

  const sendMagicLink = useCallback(async (email: string) => {
    const client = getBrowserSupabase();
    if (!client) return { ok: false, message: "Account sign-in is not configured." };
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    return error
      ? { ok: false, message: magicLinkErrorMessage(error.code) }
      : { ok: true, message: "Check your email for the secure sign-in link." };
  }, []);

  const signOut = useCallback(async () => {
    const client = getBrowserSupabase();
    if (client) await client.auth.signOut();
    linkedToken.current = null;
    setSession(null);
    window.dispatchEvent(new Event(ACCOUNT_OWNER_CHANGED_EVENT));
  }, []);

  const value = useMemo<AccountContextValue>(() => ({
    configured, loading, email: session?.user.email ?? null, sendMagicLink, signOut,
  }), [configured, loading, sendMagicLink, session?.user.email, signOut]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext);
  if (!value) throw new Error("useAccount must be used inside AccountProvider.");
  return value;
}
