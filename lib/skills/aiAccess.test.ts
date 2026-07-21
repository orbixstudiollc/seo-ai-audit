import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ safeFetchText: vi.fn() }));
vi.mock("@/lib/import", () => ({ safeFetchText: mocks.safeFetchText }));

import { parseRobotsGroups, runAiAccess } from "./aiAccess";

const origin = "https://example.com";

function mockRobotsAndLlms(robots: { status: number; text: string } | null, llms: { status: number; text: string } | null): void {
  mocks.safeFetchText.mockImplementation(async (url: string) => {
    if (url.endsWith("/robots.txt")) {
      if (robots === null) throw new Error("network down");
      return { finalUrl: "", contentType: "text/plain", ...robots };
    }
    if (url.endsWith("/llms.txt")) {
      if (llms === null) throw new Error("network down");
      return { finalUrl: "", contentType: "text/plain", ...llms };
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  mocks.safeFetchText.mockReset();
});

describe("parseRobotsGroups", () => {
  it("groups consecutive User-agent lines and attaches following rules", () => {
    const groups = parseRobotsGroups("User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n");
    expect(groups).toEqual([{ agents: ["gptbot", "ccbot"], rules: [{ type: "disallow", value: "/" }] }]);
  });

  it("starts a new group once a directive has been seen", () => {
    const groups = parseRobotsGroups("User-agent: *\nDisallow: /admin\nUser-agent: GPTBot\nAllow: /\n");
    expect(groups).toEqual([
      { agents: ["*"], rules: [{ type: "disallow", value: "/admin" }] },
      { agents: ["gptbot"], rules: [{ type: "allow", value: "/" }] },
    ]);
  });

  it("ignores an empty Disallow (means allow-all, i.e. no rule)", () => {
    const groups = parseRobotsGroups("User-agent: *\nDisallow:\n");
    expect(groups).toEqual([{ agents: ["*"], rules: [] }]);
  });
});

describe("runAiAccess", () => {
  it("blocks a crawler named in its own disallow-all group", async () => {
    mockRobotsAndLlms({ status: 200, text: "User-agent: GPTBot\nDisallow: /\n" }, null);
    const result = await runAiAccess(origin);
    const gptbot = result.crawlers.find((c) => c.name === "GPTBot");
    expect(gptbot?.allowed).toBe(false);
  });

  it("allows a crawler covered only by an allow-all wildcard group", async () => {
    mockRobotsAndLlms({ status: 200, text: "User-agent: *\nDisallow:\n" }, null);
    const result = await runAiAccess(origin);
    for (const crawler of result.crawlers) expect(crawler.allowed).toBe(true);
  });

  it("reports unspecified when robots.txt is unreachable", async () => {
    mockRobotsAndLlms(null, null);
    const result = await runAiAccess(origin);
    for (const crawler of result.crawlers) expect(crawler.allowed).toBe("unspecified");
  });

  it("reports unspecified for a crawler with no matching named or wildcard group", async () => {
    mockRobotsAndLlms({ status: 200, text: "User-agent: SomeOtherBot\nDisallow: /\n" }, null);
    const result = await runAiAccess(origin);
    const gptbot = result.crawlers.find((c) => c.name === "GPTBot");
    expect(gptbot?.allowed).toBe("unspecified");
  });

  it("named group overrides the wildcard for that crawler", async () => {
    mockRobotsAndLlms(
      { status: 200, text: "User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n" },
      null,
    );
    const result = await runAiAccess(origin);
    expect(result.crawlers.find((c) => c.name === "GPTBot")?.allowed).toBe(true);
    expect(result.crawlers.find((c) => c.name === "CCBot")?.allowed).toBe(false);
  });

  it("covers all nine rubric crawlers", async () => {
    mockRobotsAndLlms(null, null);
    const result = await runAiAccess(origin);
    expect(result.crawlers.map((c) => c.name)).toEqual([
      "GPTBot",
      "OAI-SearchBot",
      "ChatGPT-User",
      "ClaudeBot",
      "anthropic-ai",
      "PerplexityBot",
      "CCBot",
      "Bytespider",
      "cohere-ai",
    ]);
  });

  it("reports llms.txt absent when unreachable", async () => {
    mockRobotsAndLlms(null, null);
    const result = await runAiAccess(origin);
    expect(result.llmsTxt).toEqual({ present: false, hasSections: false, bytes: 0 });
  });

  it("reports llms.txt present with sections when headings exist", async () => {
    mockRobotsAndLlms(null, { status: 200, text: "# About\nSome content\n## Contact\n" });
    const result = await runAiAccess(origin);
    expect(result.llmsTxt.present).toBe(true);
    expect(result.llmsTxt.hasSections).toBe(true);
    expect(result.llmsTxt.bytes).toBeGreaterThan(0);
  });

  it("reports llms.txt present without sections when there are no headings", async () => {
    mockRobotsAndLlms(null, { status: 200, text: "just plain text, no markdown headings" });
    const result = await runAiAccess(origin);
    expect(result.llmsTxt.present).toBe(true);
    expect(result.llmsTxt.hasSections).toBe(false);
  });
});
