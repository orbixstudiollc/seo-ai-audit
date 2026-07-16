import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

// apiKeys.ts validates ENCRYPTION_KEY eagerly at module load (fail-fast at
// boot), so a valid key must already be in process.env before that module
// is evaluated. A dynamic import guarantees this ordering: static imports
// are hoisted ahead of ordinary top-level statements per the ES module
// spec, so setting process.env above a static `import ... from "./apiKeys.js"`
// would still run too late — this generates the key once, synchronously,
// then imports the module under test.
process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { decryptApiKey, encryptApiKey, keyHint } = await import("./apiKeys.js");

const USER_ID = "user_01hxyz";
const OTHER_USER_ID = "user_02abcd";
const SAMPLE_OPENAI_KEY = "sk-abcdefghijklmnopqrstuvwxyz0123456789abcd";
const SAMPLE_ANTHROPIC_KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789wxyz";

describe("encryptApiKey / decryptApiKey", () => {
  it("round-trips: decrypting with the same userId returns the original plaintext", () => {
    const blob = encryptApiKey(SAMPLE_OPENAI_KEY, USER_ID);
    expect(decryptApiKey(blob, USER_ID)).toBe(SAMPLE_OPENAI_KEY);
  });

  it("uses a fresh random IV per call, so repeated encryptions of the same key differ", () => {
    const blobA = encryptApiKey(SAMPLE_OPENAI_KEY, USER_ID);
    const blobB = encryptApiKey(SAMPLE_OPENAI_KEY, USER_ID);
    expect(blobA).not.toBe(blobB);
  });

  it("throws when decrypting with a different userId than it was encrypted with", () => {
    const blob = encryptApiKey(SAMPLE_ANTHROPIC_KEY, USER_ID);
    expect(() => decryptApiKey(blob, OTHER_USER_ID)).toThrow();
  });

  it("throws when a single character in the blob is flipped", () => {
    const blob = encryptApiKey(SAMPLE_OPENAI_KEY, USER_ID);
    const chars = blob.split("");
    let i = chars.length - 1;
    while (chars[i] === "=") i -= 1; // don't flip base64 padding, flip real payload bytes
    chars[i] = chars[i] === "A" ? "B" : "A";
    expect(() => decryptApiKey(chars.join(""), USER_ID)).toThrow();
  });

  it("throws when the blob is truncated", () => {
    const blob = encryptApiKey(SAMPLE_OPENAI_KEY, USER_ID);
    const truncated = blob.slice(0, Math.floor(blob.length / 2));
    expect(() => decryptApiKey(truncated, USER_ID)).toThrow();
  });
});

describe("keyHint", () => {
  it("keeps the OpenAI-style prefix and only the last 4 characters", () => {
    expect(keyHint(SAMPLE_OPENAI_KEY)).toBe("sk-...abcd");
  });

  it("keeps the Anthropic-style prefix and only the last 4 characters", () => {
    expect(keyHint(SAMPLE_ANTHROPIC_KEY)).toBe("sk-ant-...wxyz");
  });

  it("never reveals more than the last 4 characters, regardless of format or length (regression guard)", () => {
    const cases = [SAMPLE_OPENAI_KEY, SAMPLE_ANTHROPIC_KEY, "no-known-prefix-1234567890secretvalue", "sk-1234"];

    for (const secret of cases) {
      const hint = keyHint(secret);
      const last4 = secret.slice(-4);
      const hiddenMiddle = secret.slice(0, -4).replace(/^(sk-ant-|sk-)/, "");

      expect(hint.endsWith(last4)).toBe(true);
      if (hiddenMiddle.length > 0) {
        expect(hint).not.toContain(hiddenMiddle);
      }
    }
  });
});
