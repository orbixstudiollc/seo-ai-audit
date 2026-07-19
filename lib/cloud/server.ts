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

export interface VerifiedAccountOwner {
  userId: string;
  email: string | null;
  ownerHash: string;
}

export async function verifiedAccountFromRequest(request: Request): Promise<VerifiedAccountOwner | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token || token.length > 16_384) return null;
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    ownerHash: createHash("sha256").update(`account:${data.user.id}`).digest("hex"),
  };
}

export async function resolveOwnerHashFromRequest(request: Request): Promise<string | null> {
  const account = await verifiedAccountFromRequest(request);
  return account?.ownerHash ?? ownerHashFromRequest(request);
}
