import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Headless equivalent of the Playwright workbench journey (test/e2e/workbench.spec.ts),
 * which is skipped unless a full live env is wired. This drives the exact same
 * flow through the real route + server actions + client re-score math, with the
 * BYOK model mocked so no provider is contacted:
 *
 *   authed user -> create doc (paste) -> run audit -> DET signals arrive ->
 *   scores arrive -> rewrites arrive -> accept the intro rewrite hunk ->
 *   estimated re-score moves the bar -> true re-score (persisted) moves it for real.
 */

const H = vi.hoisted(() => ({
  session: null as { user: { id: string } } | null,
  buildModel: null as
    | ((provider: string, apiKey: string, tier: "cheap" | "strong") => unknown)
    | null,
  afterTasks: [] as Promise<unknown>[],
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => H.session } } }));
vi.mock("@/db/client", async () => {
  const { dbProxy } = await import("../helpers/testDb");
  return { db: dbProxy };
});
vi.mock("next/server", () => ({
  after: (task: unknown) => {
    H.afterTasks.push(Promise.resolve(task));
  },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/audit/provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/audit/provider")>();
  return {
    ...actual,
    buildByokModel: (provider: string, apiKey: string, tier: "cheap" | "strong") => {
      if (!H.buildModel) throw new Error("no mock model builder installed");
      return H.buildModel(provider, apiKey, tier);
    },
  };
});

import { POST } from "@/app/api/audit/route";
import { createDocument, getDocument, updateDocument } from "@/app/actions/documents";
import { apiKeys } from "@/db/schema";
import { encryptApiKey, keyHint } from "@/lib/crypto/apiKeys";
import { blendBreakdown, carryHunkStatuses } from "@/lib/audit/derive";
import { DET_SIGNAL_IDS, type Lens } from "@aeo/scoring";
import type { AuditRewrites, AuditStreamEvent } from "@/lib/audit/types";
import { closeTestDb, dbProxy, initTestDb, resetTestDb, seedUser } from "../helpers/testDb";
import { rewriteResponse, rubricResponse, scriptModel } from "../helpers/mockModel";
import { collectSse } from "../helpers/sse";

// A weak, buried-answer intro so accepting the answer-first rewrite measurably
// lifts S1 (and therefore the AI Overview / AEO lenses).
const WEAK_INTRO =
  "In today's fast-paced world there are many many considerations people weigh when they try to understand heat pumps deeply and thoroughly and this opening paragraph deliberately runs well past seventy five words while beginning with a recognised fluff opener phrase so the answer first intro signal scores low which is exactly what this journey needs in order to show the intro rewrite moving the score bar upward once the crisp answer-first replacement is accepted by the user.";

const ARTICLE = `# Heat pumps

${WEAK_INTRO}

## What is a heat pump?

A heat pump moves heat, achieving 300% efficiency. According to the DOE it holds capacity to 5F.

## What does a heat pump cost?

A typical install runs $4,000 to $8,000, and rebates cover up to $2,000.
`;

const INTRO_AFTER = "A heat pump moves heat rather than making it, reaching about 300% efficiency.";

function auditRequest(documentId: string): Request {
  return new Request("http://localhost/api/audit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.9" },
    body: JSON.stringify({ documentId, provider: "openai" }),
  });
}

async function seedOpenAiKey(userId: string): Promise<void> {
  const plaintext = "sk-fake-openai-testkey-0000";
  await dbProxy.insert(apiKeys).values({
    userId,
    provider: "openai",
    ciphertext: encryptApiKey(plaintext, userId),
    keyHint: keyHint(plaintext),
    status: "valid",
  });
}

function installModels(introBefore: string): void {
  H.buildModel = (_p, _k, tier) =>
    tier === "cheap"
      ? scriptModel(rubricResponse(70), { modelId: "mock-cheap" }).model
      : scriptModel(
          { ...rewriteResponse(introBefore), introRewrite: { before: introBefore, after: INTRO_AFTER, rationale: "answer first" } },
          { modelId: "mock-strong" },
        ).model;
}

async function flushAfter(): Promise<void> {
  await Promise.allSettled(H.afterTasks.splice(0));
}

function eventOf<T extends AuditStreamEvent["type"]>(
  events: AuditStreamEvent[],
  type: T,
): Extract<AuditStreamEvent, { type: T }> {
  const found = events.find((e) => e.type === type);
  if (!found) throw new Error(`no ${type} event in stream`);
  return found as Extract<AuditStreamEvent, { type: T }>;
}

beforeAll(async () => {
  await initTestDb();
});
afterAll(async () => {
  await closeTestDb();
});
beforeEach(async () => {
  await resetTestDb();
  H.session = null;
  H.buildModel = null;
  H.afterTasks = [];
});

describe("workbench journey (headless)", () => {
  it("paste -> audit -> accept intro rewrite -> estimated bump -> true re-score", async () => {
    // 1. Authed user with a stored key.
    const userId = await seedUser();
    await seedOpenAiKey(userId);
    H.session = { user: { id: userId } };
    installModels(WEAK_INTRO);

    // 2. New document from a paste.
    const documentId = await createDocument({ source: "paste", rawContent: ARTICLE });

    // 3. Run the audit and read the streamed phases.
    const events = await collectSse(await POST(auditRequest(documentId)));
    await flushAfter();

    // DET signals rendered: all 11 present.
    const signals = eventOf(events, "signals").signals;
    for (const id of DET_SIGNAL_IDS) expect(signals[id]).toBeDefined();

    // Scores rendered: four lenses.
    const scored = eventOf(events, "scores").scores;
    const lenses: Lens[] = ["aeo", "geo", "citability", "aiOverview"];
    for (const lens of lenses) expect(typeof scored.lenses[lens].score).toBe("number");

    // Rewrites arrived with the intro hunk.
    const rewrites: AuditRewrites = eventOf(events, "rewrites").rewrites;
    const introHunk = rewrites.hunks.find((h) => h.kind === "intro");
    expect(introHunk).toBeDefined();
    expect(introHunk!.before).toBe(WEAK_INTRO);

    // 4. Accept the intro hunk — same edit the workbench's handleAccept applies.
    const editedContent = ARTICLE.replace(introHunk!.before, introHunk!.after);
    expect(editedContent).toContain(INTRO_AFTER);
    expect(editedContent).not.toContain(WEAK_INTRO);

    // 5. Estimated re-score (free, client-side, what useLocalRescore calls):
    //    recompute DET from the edited doc, re-blend with the audit's RUB
    //    signals. The bar moves up and S1 rises.
    const before = blendBreakdown(ARTICLE, false, scored);
    const estimated = blendBreakdown(editedContent, false, scored);
    expect(estimated.lenses.aiOverview.score).toBeGreaterThan(before.lenses.aiOverview.score);
    expect(estimated.signals.S1.score).toBeGreaterThan(before.signals.S1.score);

    // 5b. THE BLOCKER the persist-first fix removes: re-running WITHOUT saving
    //     audits the STORED (old) content, whose content_hash cache-hits and
    //     serves back the same audit + old scores — an accepted rewrite alone
    //     can never confirm a better score.
    const firstAuditId = eventOf(events, "done").auditId;
    const staleEvents = await collectSse(await POST(auditRequest(documentId)));
    await flushAfter();
    expect(eventOf(staleEvents, "done").auditId).toBe(firstAuditId);
    expect(eventOf(staleEvents, "scores").scores).toEqual(scored);

    // 6. True re-score through the UI path (Workbench.handleRun): persist the
    //    working doc FIRST -> content_hash changes -> cache miss -> a real,
    //    freshly-scored audit. The persisted lens moves for real.
    installModels(INTRO_AFTER); // fresh models for the second run
    const hashBefore = (await getDocument(documentId))?.contentHash;
    await updateDocument(documentId, { rawContent: editedContent });
    const doc = await getDocument(documentId);
    expect(doc?.contentHash).not.toBe(hashBefore); // save -> new hash
    const events2 = await collectSse(await POST(auditRequest(documentId)));
    await flushAfter();
    expect(eventOf(events2, "done").auditId).not.toBe(firstAuditId); // cache miss -> fresh audit
    const scored2 = eventOf(events2, "scores").scores;
    expect(scored2.lenses.aiOverview.score).toBeGreaterThan(scored.lenses.aiOverview.score);

    // The document now holds the accepted rewrite, and the audited content IS
    // the working content — useLocalRescore's clean branch (content ===
    // trueContent) returns scored2 verbatim, clearing the estimated state.
    expect(doc?.rawContent).toBe(editedContent);

    // 7. Regression — hunk statuses must NOT leak across audits. Hunk ids are
    //    reused ("intro", "section-0", ...), so the workbench resets statuses
    //    (carryHunkStatuses) whenever a different rewrites payload lands:
    //    the second audit's hunks start unaccepted, and stale accepted ids
    //    can't make export apply a hunk the user never accepted for it.
    const rewrites2 = eventOf(events2, "rewrites").rewrites;
    const introHunk2 = rewrites2.hunks.find((h) => h.kind === "intro");
    expect(introHunk2?.id).toBe(introHunk!.id); // ids DO collide across audits
    const acceptedStatuses = { [introHunk!.id]: "accepted" as const };
    // Same payload (no new audit) -> statuses carry.
    expect(carryHunkStatuses(acceptedStatuses, rewrites, rewrites)).toBe(acceptedStatuses);
    // New payload (second audit) -> statuses reset; its intro hunk is pending.
    const secondAuditStatuses = carryHunkStatuses(acceptedStatuses, rewrites, rewrites2);
    expect(secondAuditStatuses).toEqual({});
    expect(secondAuditStatuses[introHunk2!.id]).toBeUndefined();
  });
});
