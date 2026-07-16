import { afterEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { buildServerModel, serverModelId } from "./provider";

/**
 * Coverage for the v1 server-key model factory: the test-mock escape hatch
 * (so no suite ever spends a real key or requires ANTHROPIC_API_KEY), and the
 * fixed tier -> model id mapping the audit cache/prompt logic relies on.
 */

/** `LanguageModel` also admits a bare provider-id string; every concrete model object carries `.modelId`. */
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
});

describe("serverModelId", () => {
  it("resolves a fixed model id per tier", () => {
    expect(serverModelId("cheap")).toBe("claude-haiku-4-5-20251001");
    expect(serverModelId("strong")).toBe("claude-sonnet-5");
  });
});

describe("buildServerModel — AUDIT_TEST_MOCK escape hatch", () => {
  it("returns the deterministic mock model when AUDIT_TEST_MOCK=1, without ANTHROPIC_API_KEY", () => {
    process.env.AUDIT_TEST_MOCK = "1";
    delete process.env.ANTHROPIC_API_KEY;

    const cheap = buildServerModel("cheap");
    const strong = buildServerModel("strong");

    expect(modelIdOf(cheap)).toBe("mock-cheap");
    expect(modelIdOf(strong)).toBe("mock-strong");
  });
});

describe("buildServerModel — real key path", () => {
  it("throws a clear error when ANTHROPIC_API_KEY is missing", () => {
    delete process.env.AUDIT_TEST_MOCK;
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => buildServerModel("cheap")).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("builds a real Anthropic model when a key is configured", () => {
    delete process.env.AUDIT_TEST_MOCK;
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const model = buildServerModel("strong");
    expect(modelIdOf(model)).toBe("claude-sonnet-5");
  });
});
