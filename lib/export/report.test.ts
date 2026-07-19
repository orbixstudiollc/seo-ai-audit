import { describe, expect, it } from "vitest";
import { mockReport } from "@/lib/audit/mockReport";
import { buildAuditExportBundle, buildAuditMarkdown } from "./report";

describe("audit report exports", () => {
  it("builds a portable markdown report from every result section", () => {
    const markdown = buildAuditMarkdown(mockReport);
    expect(markdown).toContain("## Scores");
    expect(markdown).toContain("## Findings");
    expect(markdown).toContain("## Optimization roadmap");
    expect(markdown).toContain("## Suggested rewrites");
    expect(markdown).toContain(mockReport.page.finalUrl);
  });

  it("builds standalone HTML, scores JSON, and FAQ JSON-LD", () => {
    const bundle = buildAuditExportBundle(mockReport);
    expect(bundle.html).toMatch(/^<!doctype html>/);
    expect(bundle.html).toContain("<h1>AI-search audit:");
    expect(bundle.html).toContain("<table>");
    expect(JSON.parse(bundle.scoresJson)).toEqual(mockReport.scores);
    expect(bundle.jsonLd).toContain('"@type": "FAQPage"');
  });

  it("escapes script terminators in embedded JSON-LD", () => {
    const report = structuredClone(mockReport);
    report.findings.qaPairs = [{ question: "Safe?", answer: "</script><script>alert(1)</script>" }];
    const bundle = buildAuditExportBundle(report);
    expect(bundle.html).not.toContain("</script><script>alert(1)");
    expect(bundle.html).toContain("\\u003c/script>");
  });
});
