import { getRequest } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const CREATOR_SESSION_COOKIE = "bmb_creator_session";
const SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

export type CreatorUserSession = {
  id: string;
  userId: string;
  expiresAt: string;
};

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateCreatorSessionToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashCreatorSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function creatorSessionToken(): string | null {
  const cookie = getRequest().headers.get("cookie");
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${CREATOR_SESSION_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function clearCreatorSessionCookie(): string {
  return `${CREATOR_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function sessionCookie(token: string): string {
  return `${CREATOR_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DURATION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Issues one first-party SocialBid session for the canonical X-backed auth user.
 * The raw credential exists only in memory and the HttpOnly cookie; the database
 * receives only its SHA-256 digest.
 */
export async function issueCreatorSession(db: SupabaseClient, userId: string): Promise<string> {
  const token = generateCreatorSessionToken();
  const tokenHash = await hashCreatorSessionToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_SECONDS * 1000).toISOString();

  // Preserve the existing one-session creator behavior. A fresh X login
  // invalidates any older browser session for this same canonical user.
  const { error: revokeError } = await db
    .from("social_bid_user_sessions")
    .update({ revoked_at: now.toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (revokeError) throw new Error("Existing creator sessions could not be revoked.");

  const { error } = await db.from("social_bid_user_sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) throw new Error("Creator session could not be created.");

  return sessionCookie(token);
}

/**
 * Resolves the HttpOnly credential through the service-only session table.
 * Expired, revoked, random and legacy creator tokens all fail closed.
 */
export async function resolveCreatorSession(
  db: SupabaseClient,
): Promise<CreatorUserSession | null> {
  const token = creatorSessionToken();
  if (!token || token.length > 200) return null;
  const tokenHash = await hashCreatorSessionToken(token);
  const { data, error } = await db
    .from("social_bid_user_sessions")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    userId: String(data.user_id),
    expiresAt: String(data.expires_at),
  };
}

export async function revokeCreatorSessions(db: SupabaseClient, userId: string): Promise<void> {
  const { error } = await db
    .from("social_bid_user_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (error) throw new Error("Creator session could not be revoked.");
}
