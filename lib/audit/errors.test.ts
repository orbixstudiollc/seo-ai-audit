import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { ImportError } from "@/lib/import";
import { mapImportError, mapLlmError } from "./errors";

describe("mapImportError", () => {
  it("maps blocked/timeout/fetch_failed import errors to fetch_failed", () => {
    expect(mapImportError(new ImportError("blocked", "nope")).kind).toBe("fetch_failed");
    expect(mapImportError(new ImportError("timeout", "slow")).kind).toBe("fetch_failed");
    expect(mapImportError(new ImportError("fetch_failed", "404")).kind).toBe("fetch_failed");
  });

  it("maps too_large/not_html import errors to unsupported_content", () => {
    expect(mapImportError(new ImportError("too_large", "big")).kind).toBe("unsupported_content");
    expect(mapImportError(new ImportError("not_html", "not html")).kind).toBe("unsupported_content");
  });

  it("carries the ImportError's user-facing message through", () => {
    expect(mapImportError(new ImportError("timeout", "took too long")).message).toBe(
      "took too long",
    );
  });
});

describe("mapLlmError", () => {
  it("maps a 429 to rate_limit with the retry-after header", () => {
    const err = new APICallError({
      message: "rate limited",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 429,
      responseHeaders: { "retry-after": "12" },
    });
    const mapped = mapLlmError(err);
    expect(mapped.kind).toBe("rate_limit");
    expect(mapped.retryAfterSec).toBe(12);
  });

  it("maps a 429 without a retry-after header to rate_limit with no retryAfterSec", () => {
    const err = new APICallError({
      message: "rate limited",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 429,
    });
    const mapped = mapLlmError(err);
    expect(mapped.kind).toBe("rate_limit");
    expect(mapped.retryAfterSec).toBeUndefined();
  });

  it("maps every other failure (5xx, network error, unknown) to server", () => {
    const serverErr = new APICallError({
      message: "boom",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 500,
    });
    expect(mapLlmError(serverErr).kind).toBe("server");
    expect(mapLlmError(new TypeError("network down")).kind).toBe("server");
    expect(mapLlmError("not even an error").kind).toBe("server");
  });

  it("never echoes the raw error message back to the caller", () => {
    const err = new APICallError({
      message: "leaked-secret-detail sk-ant-abc123",
      url: "https://api.anthropic.com/v1/messages",
      requestBodyValues: {},
      statusCode: 500,
    });
    expect(mapLlmError(err).userMessage).not.toContain("sk-ant-abc123");
  });
});
