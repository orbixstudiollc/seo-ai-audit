"use client";

import { useSiteAuditStream } from "@/app/hooks/useSiteAuditStream";
import { SiteAuditReportView } from "./SiteAuditReportView";

type Props = {
  url: string;
};

/** Live container: streams `url` through /api/audit/bulk and renders the progressive site report. */
export function SiteAuditRunner({ url }: Props) {
  const stream = useSiteAuditStream(url);

  return (
    <SiteAuditReportView
      phase={stream.phase}
      rootUrl={stream.rootUrl}
      method={stream.method}
      discoveredPages={stream.discoveredPages}
      truncated={stream.truncated}
      pages={stream.pages}
      pageOrder={stream.pageOrder}
      rollup={stream.rollup}
      stoppedEarly={stream.stoppedEarly}
      error={stream.error}
      onRetry={stream.retry}
    />
  );
}
