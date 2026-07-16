import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const H = vi.hoisted(() => ({ session: null as { user: { id: string } } | null }));

vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: async () => H.session } },
}));

vi.mock("@/db/client", async () => {
  const { dbProxy } = await import("../helpers/testDb");
  return { db: dbProxy };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  updateDocument,
} from "@/app/actions/documents";
import { audits, documents } from "@/db/schema";
import { RUBRIC_VERSION } from "@aeo/scoring";
import { closeTestDb, dbProxy, initTestDb, resetTestDb, seedUser } from "../helpers/testDb";

const DOC = "# Choosing a project tool\n\nPick the one your team will actually open daily.\n";

beforeAll(async () => {
  await initTestDb();
});

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  H.session = null;
});

async function insertCompletedAudit(
  userId: string,
  documentId: string,
  lens: number,
  eeatScore?: number,
): Promise<void> {
  await dbProxy.insert(audits).values({
    userId,
    documentId,
    status: "completed",
    contentHash: "hash",
    rubricVersion: RUBRIC_VERSION,
    signalsVersion: "v1.0.0",
    modelId: "gpt-5-mini",
    scores: {
      lenses: {
        aeo: { lens: "aeo", score: lens, capped: false },
        geo: { lens: "geo", score: lens, capped: false },
        citability: { lens: "citability", score: lens, capped: false },
        aiOverview: { lens: "aiOverview", score: lens, capped: false },
      },
      ...(eeatScore !== undefined ? { signals: { S17: { score: eeatScore } } } : {}),
    },
    completedAt: new Date(),
  });
}

describe("document actions — auth boundary", () => {
  it("throws when unauthenticated", async () => {
    H.session = null;
    await expect(listDocuments()).rejects.toThrow(/unauthorized/i);
    await expect(createDocument({ source: "paste", rawContent: DOC })).rejects.toThrow(/unauthorized/i);
  });
});

describe("document actions — user scoping", () => {
  it("user A cannot read user B's document", async () => {
    const userA = await seedUser("a");
    const userB = await seedUser("b");

    H.session = { user: { id: userB } };
    const docId = await createDocument({ source: "paste", rawContent: DOC });

    // A tries to read B's document by id → null (WHERE clause carries the user id).
    H.session = { user: { id: userA } };
    expect(await getDocument(docId)).toBeNull();

    // B still sees it.
    H.session = { user: { id: userB } };
    expect(await getDocument(docId)).not.toBeNull();
  });

  it("listDocuments returns only the caller's own documents", async () => {
    const userA = await seedUser("a");
    const userB = await seedUser("b");

    H.session = { user: { id: userA } };
    await createDocument({ source: "paste", rawContent: DOC });
    await createDocument({ source: "paste", rawContent: "# Second\n\nAnother one.\n" });

    H.session = { user: { id: userB } };
    await createDocument({ source: "paste", rawContent: "# B doc\n\nBelongs to B.\n" });

    H.session = { user: { id: userA } };
    const listed = await listDocuments();
    expect(listed).toHaveLength(2);
  });

  it("user A cannot update user B's document", async () => {
    const userA = await seedUser("a");
    const userB = await seedUser("b");
    H.session = { user: { id: userB } };
    const docId = await createDocument({ source: "paste", rawContent: DOC });

    H.session = { user: { id: userA } };
    await expect(updateDocument(docId, { title: "Hijacked" })).rejects.toThrow(/not found/i);

    // B's document is untouched.
    H.session = { user: { id: userB } };
    const stillThere = await getDocument(docId);
    expect(stillThere?.title).not.toBe("Hijacked");
  });

  it("user A cannot delete user B's document", async () => {
    const userA = await seedUser("a");
    const userB = await seedUser("b");
    H.session = { user: { id: userB } };
    const docId = await createDocument({ source: "paste", rawContent: DOC });

    H.session = { user: { id: userA } };
    await deleteDocument(docId); // scoped delete is a no-op for a non-owner

    const rows = await dbProxy.select().from(documents).where(eq(documents.id, docId));
    expect(rows).toHaveLength(1); // B's document still exists
  });
});

describe("document actions — read model", () => {
  it("createDocument derives a title from the first heading and counts words", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const id = await createDocument({ source: "paste", rawContent: DOC });

    const [row] = await dbProxy.select().from(documents).where(eq(documents.id, id));
    expect(row.title).toBe("Choosing a project tool");
    expect(row.wordCount).toBeGreaterThan(0);
    expect(row.userId).toBe(userId);
  });

  it("listDocuments surfaces the latest completed audit's four lens scores", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const id = await createDocument({ source: "paste", rawContent: DOC });
    await insertCompletedAudit(userId, id, 80);

    const [item] = await listDocuments();
    expect(item.latestScores).toEqual({ aeo: 80, geo: 80, citability: 80, aiOverview: 80 });
  });

  it("listDocuments surfaces the latest completed audit's E-E-A-T (S17) signal score", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const id = await createDocument({ source: "paste", rawContent: DOC });
    await insertCompletedAudit(userId, id, 80, 65);

    const [item] = await listDocuments();
    expect(item.eeatScore).toBe(65);
  });

  it("listDocuments returns a null eeatScore when the stored audit predates signal-level storage", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const id = await createDocument({ source: "paste", rawContent: DOC });
    await insertCompletedAudit(userId, id, 80); // no eeatScore arg -> no `signals` key at all

    const [item] = await listDocuments();
    expect(item.eeatScore).toBeNull();
  });

  it("updateDocument re-derives word count and content hash for the owner", async () => {
    const userId = await seedUser();
    H.session = { user: { id: userId } };
    const id = await createDocument({ source: "paste", rawContent: DOC });
    const [before] = await dbProxy.select().from(documents).where(eq(documents.id, id));

    const updated = await updateDocument(id, {
      rawContent: "# Longer\n\n" + "word ".repeat(50),
    });
    expect(updated.wordCount).toBeGreaterThan(before.wordCount);
    expect(updated.contentHash).not.toBe(before.contentHash);
  });
});
