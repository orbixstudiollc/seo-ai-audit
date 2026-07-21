"use client";

import { useAgentStream } from "@/app/hooks/useAgentStream";
import { AgentReportView } from "./AgentReportView";

type Props = {
  url: string;
};

/**
 * Live container: streams `url` through /api/audit/agent (planOnly dry run
 * on mount, confirm() re-POSTs the real run) and renders the progressive
 * agent report. Kept minimal for this slice — just runs the stream and
 * renders the view, mirroring SiteAuditRunner's shape without its
 * persistence effect.
 *
 * TODO(SK3): persist AgentStreamState to history + a SavedAgentReport (cloud
 * sync, reopen-and-resolve-pending-tasks), mirroring SiteAuditRunner's
 * autoSaveAudits effect, once the agent run is durable server-side
 * (agent_runs table, DATA-CONTRACT §9).
 */
export function AgentAuditRunner({ url }: Props) {
  const stream = useAgentStream(url);
  return <AgentReportView url={url} {...stream} />;
}
