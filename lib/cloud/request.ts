"use client";

import { getBrowserSupabase } from "@/lib/auth/client";
import { CLOUD_OWNER_HEADER, getCloudOwnerToken } from "./owner";

export async function cloudRequestHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    [CLOUD_OWNER_HEADER]: getCloudOwnerToken(window.localStorage),
  };
  const client = getBrowserSupabase();
  if (!client) return headers;
  const { data } = await client.auth.getSession();
  if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  return headers;
}

export async function cloudFetch(path: string, init: RequestInit): Promise<Response> {
  const ownerHeaders = await cloudRequestHeaders();
  return fetch(path, {
    ...init,
    headers: { ...ownerHeaders, ...init.headers },
    cache: "no-store",
  });
}
