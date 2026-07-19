export function magicLinkErrorMessage(code?: string): string {
  if (code === "email_address_invalid") return "Enter a valid email address.";
  if (code === "over_email_send_rate_limit") {
    return "Email sign-in is temporarily rate-limited. Try again later.";
  }
  return "The sign-in email could not be sent. Try again shortly.";
}
