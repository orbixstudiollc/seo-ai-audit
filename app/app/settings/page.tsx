import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getKeyStatuses } from "@/app/actions/keys";
import { auth } from "@/lib/auth";
import { KeySettingsForm } from "./KeySettingsForm";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const keys = await getKeyStatuses();

  return (
    <div className="flex flex-1 flex-col font-sans text-text-1">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-5 md:px-10">
          <Link
            href="/app"
            className="font-mono text-sm font-semibold uppercase tracking-[0.2em]"
          >
            AEO/GEO Optimizer
          </Link>
          <Link
            href="/app"
            className="font-mono text-xs uppercase tracking-wide text-text-2 transition-colors hover:text-text-1"
          >
            &larr; Back to app
          </Link>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-4xl px-6 py-12 md:px-10 md:py-16">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent-ink">Settings</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">API keys</h1>

          <p className="mt-4 max-w-2xl leading-relaxed text-text-2">
            Audits run on your own OpenAI or Anthropic key &mdash; a full 1,500-word audit costs
            pennies, not a subscription markup. You need a{" "}
            <span className="font-medium text-text-1">platform.openai.com</span> or{" "}
            <span className="font-medium text-text-1">console.anthropic.com</span> API key. A
            ChatGPT&nbsp;Plus or Claude.ai subscription will <span className="font-medium">not</span>{" "}
            work &mdash; those aren&apos;t API keys.
          </p>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-2">
            This is a self-hosted, open-source tool. Your key is encrypted at rest (AES-256-GCM,
            cryptographically bound to your account) in your own database, and is only ever decrypted
            in-memory to run an audit &mdash; no endpoint here can hand it back in plaintext.
          </p>

          <div className="mt-10">
            <KeySettingsForm initialKeys={keys} />
          </div>
        </div>
      </main>
    </div>
  );
}
