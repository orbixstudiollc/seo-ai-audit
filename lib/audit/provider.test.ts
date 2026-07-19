import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import type { LanguageModel } from "ai";
import { buildServerModel, resolveProvider, serverModelId } from "./provider";

/**
 * Coverage for the v1 flexible provider factory:
 *  - `resolveProvider`'s env-driven precedence/fallback (the part a
 *    misconfiguration would silently get wrong)
 *  - the test-mock escape hatch (so no suite ever spends a real key)
 *  - a mocked round trip proving the openai-compatible path actually hits
 *    the classic chat/completions route (not the newer responses API) with
 *    the configured base URL, key, and model — the exact quirk that broke a
 *    live third-party endpoint in the pre-pivot BYOK code this was salvaged
 *    from.
 */

/** `LanguageModel` also admits a bare provider-id string; every concrete model object carries `.modelId`. */
function modelIdOf(model: LanguageModel): string {
  return typeof model === "string" ? model : model.modelId;
}

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function clearProviderEnv(): void {
  delete process.env.AUDIT_TEST_MOCK;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_API_KEY;
  delete process.env.AI_BASE_URL;
  delete process.env.AI_MODEL;
}

describe("serverModelId", () => {
  it("resolves a fixed model id per tier", () => {
    expect(serverModelId("cheap")).toBe("claude-haiku-4-5-20251001");
    expect(serverModelId("strong")).toBe("claude-haiku-4-5-20251001");
  });
});

describe("resolveProvider — precedence and fallback", () => {
  it("returns null when nothing is configured", () => {
    expect(resolveProvider({})).toBeNull();
  });

  it("legacy fallback: ANTHROPIC_API_KEY alone resolves to anthropic with no overrides", () => {
    const resolved = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-legacy" });
    expect(resolved).toEqual({ kind: "anthropic", apiKey: "sk-ant-legacy" });
  });

  it("AI_PROVIDER=anthropic prefers AI_API_KEY over ANTHROPIC_API_KEY", () => {
    const resolved = resolveProvider({
      AI_PROVIDER: "anthropic",
      AI_API_KEY: "sk-ant-explicit",
      ANTHROPIC_API_KEY: "sk-ant-legacy",
    });
    expect(resolved).toMatchObject({ kind: "anthropic", apiKey: "sk-ant-explicit" });
  });

  it("AI_PROVIDER=anthropic falls back to ANTHROPIC_API_KEY when AI_API_KEY is unset", () => {
    const resolved = resolveProvider({ AI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-ant-legacy" });
    expect(resolved).toMatchObject({ kind: "anthropic", apiKey: "sk-ant-legacy" });
  });

  it("AI_PROVIDER=anthropic with no key at all resolves to null", () => {
    expect(resolveProvider({ AI_PROVIDER: "anthropic" })).toBeNull();
  });

  it("AI_PROVIDER=anthropic carries an optional AI_BASE_URL / AI_MODEL override", () => {
    const resolved = resolveProvider({
      AI_PROVIDER: "anthropic",
      AI_API_KEY: "sk-ant-explicit",
      AI_BASE_URL: "https://anthropic-proxy.example.com",
      AI_MODEL: "claude-custom",
    });
    expect(resolved).toEqual({
      kind: "anthropic",
      apiKey: "sk-ant-explicit",
      baseUrl: "https://anthropic-proxy.example.com",
      model: "claude-custom",
    });
  });

  it("AI_PROVIDER=openai-compatible requires AI_API_KEY, AI_BASE_URL, and AI_MODEL together", () => {
    expect(
      resolveProvider({ AI_PROVIDER: "openai-compatible", AI_API_KEY: "sk-or-key" }),
    ).toBeNull();
    expect(
      resolveProvider({
        AI_PROVIDER: "openai-compatible",
        AI_API_KEY: "sk-or-key",
        AI_BASE_URL: "https://openrouter.ai/api/v1",
      }),
    ).toBeNull();

    const resolved = resolveProvider({
      AI_PROVIDER: "openai-compatible",
      AI_API_KEY: "sk-or-key",
      AI_BASE_URL: "https://openrouter.ai/api/v1",
      AI_MODEL: "anthropic/claude-haiku-4.5",
    });
    expect(resolved).toEqual({
      kind: "openai-compatible",
      apiKey: "sk-or-key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "anthropic/claude-haiku-4.5",
    });
  });

  it("an unrecognized AI_PROVIDER value falls back to the legacy ANTHROPIC_API_KEY path", () => {
    const resolved = resolveProvider({ AI_PROVIDER: "not-a-real-provider", ANTHROPIC_API_KEY: "sk-ant-legacy" });
    expect(resolved).toEqual({ kind: "anthropic", apiKey: "sk-ant-legacy" });
  });

  it("ANTHROPIC_API_KEY-only deployments are unaffected: no AI_* vars needed", () => {
    const resolved = resolveProvider({ ANTHROPIC_API_KEY: "sk-ant-prod" });
    expect(resolved?.kind).toBe("anthropic");
    expect(resolved?.baseUrl).toBeUndefined();
    expect(resolved?.model).toBeUndefined();
  });
});

describe("buildServerModel — AUDIT_TEST_MOCK escape hatch", () => {
  it("returns the deterministic mock model when AUDIT_TEST_MOCK=1, with no provider configured", () => {
    clearProviderEnv();
    process.env.AUDIT_TEST_MOCK = "1";

    const cheap = buildServerModel("cheap");
    const strong = buildServerModel("strong");

    expect(modelIdOf(cheap)).toBe("mock-cheap");
    expect(modelIdOf(strong)).toBe("mock-strong");
  });
});

describe("buildServerModel — no provider configured", () => {
  it("throws a clear, actionable error naming both configuration paths", () => {
    clearProviderEnv();
    expect(() => buildServerModel("cheap")).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => buildServerModel("cheap")).toThrow(/AI_PROVIDER/);
  });
});

describe("buildServerModel — anthropic path", () => {
  it("builds a real Anthropic model on the legacy ANTHROPIC_API_KEY-only path (no breaking change)", () => {
    clearProviderEnv();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";

    const model = buildServerModel("strong");
    expect(modelIdOf(model)).toBe("claude-haiku-4-5-20251001");
  });

  it("uses AI_MODEL for both tiers when AI_PROVIDER=anthropic overrides it", () => {
    clearProviderEnv();
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "sk-ant-explicit";
    process.env.AI_MODEL = "claude-custom-model";

    expect(modelIdOf(buildServerModel("cheap"))).toBe("claude-custom-model");
    expect(modelIdOf(buildServerModel("strong"))).toBe("claude-custom-model");
  });
});

describe("buildServerModel — openai-compatible path (mocked round trip)", () => {
  function captureRequest(): { urlOf: () => string; authHeaderOf: () => string; bodyModelOf: () => string } {
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      throw new Error(
        `captured:${typeof input === "string" ? input : input.toString()}:${JSON.stringify(init?.body ?? "")}:${String((init?.headers as Record<string, string> | undefined)?.authorization ?? "")}`,
      );
    });
    vi.stubGlobal("fetch", spy);
    return {
      urlOf: () => {
        const call = spy.mock.calls[0]?.[0] as RequestInfo | URL | undefined;
        return call ? (typeof call === "string" ? call : call.toString()) : "";
      },
      authHeaderOf: () => {
        const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
        return String((init?.headers as Record<string, string> | undefined)?.authorization ?? "");
      },
      bodyModelOf: () => {
        const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = init?.body;
        if (typeof body !== "string") return "";
        return (JSON.parse(body) as { model?: string }).model ?? "";
      },
    };
  }

  it("hits the classic chat/completions route (not /responses) with the configured base URL, key, and model", async () => {
    clearProviderEnv();
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_API_KEY = "sk-or-test-key";
    process.env.AI_BASE_URL = "https://openrouter.ai/api/v1";
    process.env.AI_MODEL = "anthropic/claude-haiku-4.5";

    const { urlOf, authHeaderOf, bodyModelOf } = captureRequest();
    const model = buildServerModel("cheap");

    await generateText({ model, prompt: "ping", maxOutputTokens: 1, maxRetries: 0 }).catch(() => {});

    expect(urlOf()).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(urlOf()).not.toContain("/responses");
    expect(authHeaderOf()).toContain("sk-or-test-key");
    expect(bodyModelOf()).toBe("anthropic/claude-haiku-4.5");
  });

  it("both tiers resolve to the same single AI_MODEL (no cheap/strong split for custom providers)", () => {
    clearProviderEnv();
    process.env.AI_PROVIDER = "openai-compatible";
    process.env.AI_API_KEY = "ollama";
    process.env.AI_BASE_URL = "http://localhost:11434/v1";
    process.env.AI_MODEL = "llama3.1";

    expect(modelIdOf(buildServerModel("cheap"))).toBe("llama3.1");
    expect(modelIdOf(buildServerModel("strong"))).toBe("llama3.1");
  });
});
