"use client";

import { useState } from "react";
import { cloudFetch } from "@/lib/cloud/request";
import { Button } from "@/app/components/ui/Button";

type ShareState = "idle" | "working" | "copied" | "error";

const LABEL: Record<ShareState, string> = {
  idle: "Copy public link",
  working: "Creating link…",
  copied: "Public link copied",
  error: "Sharing unavailable",
};

/**
 * Mints (or reuses) the report's public share token and copies the /s/<token>
 * URL. Opt-in per report — nothing is public until this is clicked (D-021).
 */
export function ShareLinkButton({ auditId }: { auditId: string }) {
  const [state, setState] = useState<ShareState>("idle");

  const share = async () => {
    setState("working");
    try {
      const response = await cloudFetch("/api/share", {
        method: "POST",
        body: JSON.stringify({ auditId }),
      });
      if (!response.ok) throw new Error("share_failed");
      const body = await response.json() as { token?: string };
      if (!body.token) throw new Error("share_failed");
      await navigator.clipboard.writeText(`${window.location.origin}/s/${body.token}`);
      setState("copied");
    } catch {
      setState("error");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={share} disabled={state === "working"}>
        {LABEL[state]}
      </Button>
      {state === "error" && (
        <span role="alert" className="text-xs text-text-2">
          Cloud storage is unavailable — the report can’t be shared right now.
        </span>
      )}
    </span>
  );
}
