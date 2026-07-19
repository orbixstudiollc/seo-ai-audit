import { describe, expect, it } from "vitest";
import { getCloudOwnerToken, isCloudOwnerToken } from "./owner";

describe("cloud workspace ownership", () => {
  it("creates a stable 256-bit URL-safe token", () => {
    let value: string | null = null;
    const storage = { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
    const first = getCloudOwnerToken(storage);
    const second = getCloudOwnerToken(storage);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects missing, short, and malformed ownership tokens", () => {
    expect(isCloudOwnerToken(null)).toBe(false);
    expect(isCloudOwnerToken("short")).toBe(false);
    expect(isCloudOwnerToken(`${"a".repeat(42)}!`)).toBe(false);
    expect(isCloudOwnerToken("a".repeat(43))).toBe(true);
  });
});

