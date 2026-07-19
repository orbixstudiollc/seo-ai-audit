import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CLOUD_OWNER_HEADER, isCloudOwnerToken } from "./owner";

let cachedClient: SupabaseClient | null = null;

export function cloudHistoryConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw new Error("Supabase history storage is not configured.");
  cachedClient = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cachedClient;
}

export function ownerHashFromRequest(request: Request): string | null {
  const token = request.headers.get(CLOUD_OWNER_HEADER);
  if (!isCloudOwnerToken(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

