import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { buildCustomModel, modelIdFor } from "./provider";

/**
 * Regression coverage for two request-path bugs found by actually calling a
 * live third-party endpoint (a raw curl succeeded; the AI-SDK-driven call
 * 404'd) rather than by reading the SDK's types:
 *
 * 1. `@ai-sdk/anthropic`'s `createAnthropic({baseURL})` appends `/messages`
 *    directly — it does NOT insert `/v1`. A bare host (the form this app's
 *    own "API Endpoint" field asks for) 404s unless `/v1` is added first.
 * 2. `createOpenAI(...)` called directly targets OpenAI's newer Responses API
 *    (`/responses`) by default; third-party OpenAI-compatible proxies almost
 *    universally implement the classic Chat Completions API instead.
 *
 * These assert the actual URL a request would hit, captured via a fetch spy
 * that throws before any real network call — no live endpoint needed to
 * keep this failing loudly if either SDK's default path ever changes again.
 */

function captureRequestUrl(): { spy: ReturnType<typeof vi.fn>; urlOf: () => string } {
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(`captured:${typeof input === "string" ? input : input.toString()}`);
  });
  vi.stubGlobal("fetch", spy);
  return {
    spy,
    urlOf: () => {
      const call = spy.mock.calls[0]?.[0] as RequestInfo | URL | undefined;
      return call ? (typeof call === "string" ? call : call.toString()) : "";
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildCustomModel — request path construction", () => {
  it("anthropic format: inserts /v1 before /messages for a bare base URL", async () => {
    const { urlOf } = captureRequestUrl();
    const model = buildCustomModel("sk-test", {
      baseUrl: "https://api.example.com",
      apiFormat: "anthropic",
      cheapModel: "claude-haiku-4.5",
      strongModel: "claude-sonnet-5",
    }, "claude-haiku-4.5");

    await generateText({ model, prompt: "ping", maxOutputTokens: 1, maxRetries: 0 }).catch(() => {});

    expect(urlOf()).toBe("https://api.example.com/v1/messages");
  });

  it("anthropic format: strips a trailing slash before inserting /v1 (no double slash)", async () => {
    const { urlOf } = captureRequestUrl();
    const model = buildCustomModel("sk-test", {
      baseUrl: "https://api.example.com/",
      apiFormat: "anthropic",
      cheapModel: "claude-haiku-4.5",
      strongModel: "claude-sonnet-5",
    }, "claude-haiku-4.5");

    await generateText({ model, prompt: "ping", maxOutputTokens: 1, maxRetries: 0 }).catch(() => {});

    expect(urlOf()).toBe("https://api.example.com/v1/messages");
  });

  it("openai format: hits the classic chat/completions route, not the newer responses route", async () => {
    const { urlOf } = captureRequestUrl();
    const model = buildCustomModel("sk-test", {
      baseUrl: "https://api.example.com/v1",
      apiFormat: "openai",
      cheapModel: "gpt-compatible-model",
      strongModel: "gpt-compatible-model-strong",
    }, "gpt-compatible-model");

    await generateText({ model, prompt: "ping", maxOutputTokens: 1, maxRetries: 0 }).catch(() => {});

    expect(urlOf()).toBe("https://api.example.com/v1/chat/completions");
    expect(urlOf()).not.toContain("/responses");
  });
});

describe("modelIdFor — custom provider", () => {
  const custom = {
    baseUrl: "https://api.example.com",
    apiFormat: "anthropic" as const,
    cheapModel: "cheap-id",
    strongModel: "strong-id",
  };

  it("resolves the cheap and strong tiers from the custom config, not the named-provider MODEL_IDS map", () => {
    expect(modelIdFor("custom", "cheap", custom)).toBe("cheap-id");
    expect(modelIdFor("custom", "strong", custom)).toBe("strong-id");
  });

  it("throws if called for \"custom\" without a config, rather than silently resolving nothing", () => {
    expect(() => modelIdFor("custom", "cheap")).toThrow();
  });
});
