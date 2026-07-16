import { describe, expect, it } from "vitest";
import { AUDIT_URL_MAX_LENGTH, parseAuditUrl } from "./requestValidation";

describe("parseAuditUrl", () => {
  it("accepts absolute http(s) URLs", () => {
    expect(parseAuditUrl("https://example.com/article")).toBeInstanceOf(URL);
    expect(parseAuditUrl("http://example.com/article")).toBeInstanceOf(URL);
  });

  it("rejects non-string input", () => {
    expect(parseAuditUrl(undefined)).toBeNull();
    expect(parseAuditUrl(null)).toBeNull();
    expect(parseAuditUrl(123)).toBeNull();
    expect(parseAuditUrl({})).toBeNull();
  });

  it("rejects an empty string", () => {
    expect(parseAuditUrl("")).toBeNull();
  });

  it("rejects a URL longer than 2048 chars", () => {
    const longUrl = `https://example.com/${"a".repeat(AUDIT_URL_MAX_LENGTH)}`;
    expect(longUrl.length).toBeGreaterThan(AUDIT_URL_MAX_LENGTH);
    expect(parseAuditUrl(longUrl)).toBeNull();
  });

  it("accepts a URL right at the length boundary", () => {
    const base = "https://example.com/";
    const padded = base + "a".repeat(AUDIT_URL_MAX_LENGTH - base.length);
    expect(padded.length).toBe(AUDIT_URL_MAX_LENGTH);
    expect(parseAuditUrl(padded)).toBeInstanceOf(URL);
  });

  it("rejects non-http(s) schemes", () => {
    expect(parseAuditUrl("ftp://example.com/file")).toBeNull();
    expect(parseAuditUrl("file:///etc/passwd")).toBeNull();
    expect(parseAuditUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects malformed URLs", () => {
    expect(parseAuditUrl("not a url at all")).toBeNull();
    expect(parseAuditUrl("example.com/no-scheme")).toBeNull();
  });
});
