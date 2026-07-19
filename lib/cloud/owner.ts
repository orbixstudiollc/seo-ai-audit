export const CLOUD_OWNER_KEY = "seo-ai-audit:cloud-owner:v1";
export const CLOUD_OWNER_HEADER = "x-seo-audit-owner";

const OWNER_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isCloudOwnerToken(value: unknown): value is string {
  return typeof value === "string" && OWNER_PATTERN.test(value);
}

function createOwnerToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function getCloudOwnerToken(storage: Pick<Storage, "getItem" | "setItem">): string {
  const existing = storage.getItem(CLOUD_OWNER_KEY);
  if (isCloudOwnerToken(existing)) return existing;
  const created = createOwnerToken();
  storage.setItem(CLOUD_OWNER_KEY, created);
  return created;
}

