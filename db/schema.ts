import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Plain "postgresql" dialect — works against any standard Postgres (Supabase,
// Neon, RDS, local). The app's db client (db/client.ts) wires up the runtime
// driver separately; this file just defines table shapes for drizzle-kit
// generate/migrate and the query builder.

// -----------------------------------------------------------------------
// Better Auth core tables. Field set matches Better Auth's documented
// Drizzle adapter shape exactly (verified against
// @better-auth/core's `getAuthTables` — the canonical field list the
// drizzle adapter maps to at runtime). Better Auth always generates its own
// `id` value application-side before insert, so `id` is plain `text` with
// no database-level default, not a generated uuid.
// -----------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// -----------------------------------------------------------------------
// App tables — plan "Data model" section, amended per
// .context/plan-validation-synthesis.md (key rotation, scores/rewrites
// partial-failure tracking, idempotency guard). The `waitlist` table and the
// user `beta_access` flag were removed in the open-source/BYOK pivot (no beta
// gating, no invite flow).
// -----------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["openai", "anthropic", "custom"] }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    keyHint: text("key_hint").notNull(),
    /** Bumped on rotation so an ENCRYPTION_KEY rotation never needs a big-bang re-encrypt migration (synthesis amendment #10). */
    keyVersion: integer("key_version").notNull().default(1),
    status: text("status", { enum: ["valid", "invalid", "quota"] })
      .notNull()
      .default("valid"),
    lastValidatedAt: timestamp("last_validated_at"),
    // Custom-provider config (provider = "custom" only; null otherwise). Lets a
    // user point audits at any OpenAI- or Anthropic-compatible endpoint — a
    // proxy, reseller, or self-hosted gateway — with their own model ids, since
    // an arbitrary third-party endpoint's models can't be a static map like
    // MODEL_IDS in lib/audit/provider.ts.
    customName: text("custom_name"),
    baseUrl: text("base_url"),
    apiFormat: text("api_format", { enum: ["openai", "anthropic"] }),
    cheapModel: text("cheap_model"),
    strongModel: text("strong_model"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("api_keys_user_id_provider_idx").on(table.userId, table.provider),
  ],
);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  source: text("source", { enum: ["paste", "url"] }).notNull(),
  sourceUrl: text("source_url"),
  rawContent: text("raw_content").notNull(),
  contentHash: text("content_hash").notNull(),
  wordCount: integer("word_count").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const audits = pgTable(
  "audits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    contentHash: text("content_hash").notNull(),
    rubricVersion: text("rubric_version").notNull(),
    signalsVersion: text("signals_version").notNull(),
    modelId: text("model_id").notNull(),
    scores: jsonb("scores"),
    findings: jsonb("findings"),
    rewrites: jsonb("rewrites"),
    error: text("error"),
    /** Independently tracks LLM call 1 ("audit brain") so a call-2 (generator) failure never discards call 1's already-paid-for results (synthesis amendment #11). */
    scoresStatus: text("scores_status", { enum: ["pending", "done", "failed"] })
      .notNull()
      .default("pending"),
    rewritesStatus: text("rewrites_status", { enum: ["pending", "done", "failed"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("audits_user_content_rubric_idx").on(
      table.userId,
      table.contentHash,
      table.rubricVersion,
    ),
    // Partial unique index, not a plain composite unique constraint: scopes
    // the double-spend guard to completed audits only, so a running/failed
    // row for the same cache key never blocks a legitimate retry (synthesis
    // amendment #6).
    uniqueIndex("audits_completed_cache_key_idx")
      .on(table.userId, table.contentHash, table.rubricVersion, table.modelId)
      .where(sql`${table.status} = 'completed'`),
    // Second partial unique index scoped to RUNNING rows: makes the route's
    // duplicate-start guard atomic (insert-first, catch unique violation as
    // 409 already_running), so two truly simultaneous POSTs for the same cache
    // key can never both insert a running row and double-spend the user's key.
    uniqueIndex("audits_running_cache_key_idx")
      .on(table.userId, table.contentHash, table.rubricVersion, table.modelId)
      .where(sql`${table.status} = 'running'`),
  ],
);

