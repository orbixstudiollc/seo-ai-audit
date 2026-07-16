"use client";

import { useAuditStream } from "@/app/hooks/useAuditStream";
import { AuditReportView } from "./AuditReportView";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit and renders the progressive report. */
export function AuditRunner({ url }: Props) {
  const stream = useAuditStream(url);

  return (
    <AuditReportView
      phase={stream.phase}
      page={stream.page}
      signals={stream.signals}
      scores={stream.scores}
      findings={stream.findings}
      rewrites={stream.rewrites}
      error={stream.error}
      onRetry={stream.retry}
    />
  );
}
