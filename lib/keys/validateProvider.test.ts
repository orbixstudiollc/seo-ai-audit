import { describe, expect, it } from "vitest";
import { classifyProviderResponse } from "./validateProvider";

// The storage decision is a money/security branch: a wrong classification
// either stores a dead key or discards a real one. This locks the mapping.
describe("classifyProviderResponse", () => {
  it("treats any 2xx as a valid, storable key", () => {
    expect(classifyProviderResponse(200, undefined)).toEqual({ ok: true });
  });

  it("treats 401/403 as an invalid key that must never be stored", () => {
    expect(classifyProviderResponse(401, undefined)).toEqual({ ok: false, kind: "invalid" });
    expect(classifyProviderResponse(403, "authentication_error")).toEqual({
      ok: false,
      kind: "invalid",
    });
  });

  it("stores a 429 + insufficient_quota as a real key flagged out of quota", () => {
    expect(classifyProviderResponse(429, "insufficient_quota")).toEqual({
      ok: false,
      kind: "quota",
    });
  });

  it("treats a bare 429 as transient rate limiting (not stored)", () => {
    expect(classifyProviderResponse(429, "rate_limit_exceeded")).toEqual({
      ok: false,
      kind: "rate_limited",
    });
  });

  it("treats other non-2xx statuses as a generic provider error", () => {
    expect(classifyProviderResponse(500, undefined)).toEqual({
      ok: false,
      kind: "provider_error",
    });
    expect(classifyProviderResponse(400, "invalid_request_error")).toEqual({
      ok: false,
      kind: "provider_error",
    });
  });
});
