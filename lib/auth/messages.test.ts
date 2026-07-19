import { describe, expect, it } from "vitest";
import { magicLinkErrorMessage } from "./messages";

describe("magicLinkErrorMessage", () => {
  it("explains invalid addresses without leaking provider details", () => {
    expect(magicLinkErrorMessage("email_address_invalid")).toBe("Enter a valid email address.");
  });

  it("gives a retryable message for the Supabase email limit", () => {
    expect(magicLinkErrorMessage("over_email_send_rate_limit")).toContain("temporarily rate-limited");
  });

  it("keeps unknown provider failures generic", () => {
    expect(magicLinkErrorMessage("smtp_failure")).toBe("The sign-in email could not be sent. Try again shortly.");
  });
});
