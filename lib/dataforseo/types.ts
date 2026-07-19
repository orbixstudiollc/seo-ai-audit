export type TechnicalAuditStatus = "queued" | "running" | "complete" | "failed";

export interface TechnicalSeoPage {
  url: string;
  statusCode: number | null;
  title: string;
  onpageScore: number | null;
  clickDepth: number | null;
  issueKeys: string[];
}

export interface TechnicalSeoResult {
  target: string;
  crawlProgress: "in_progress" | "finished";
  maxCrawlPages: number;
  pagesCrawled: number;
  pagesInQueue: number;
  onpageScore: number | null;
  pages: TechnicalSeoPage[];
}

export interface TechnicalAuditTask {
  auditId: string;
  providerTaskId: string;
  status: TechnicalAuditStatus;
  costUsd: number | null;
  createdAt: string;
  updatedAt: string;
  result: TechnicalSeoResult | null;
  errorMessage: string | null;
}

export interface StartedOnPageTask {
  taskId: string;
  costUsd: number;
}

export interface PolledOnPageTask {
  status: "running" | "complete";
  result: TechnicalSeoResult;
}
