import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";

const GUEST_CLAIM_COOKIE = "social_bid_guest_claim";
const RECOVERY_CLAIM_COOKIE = "social_bid_buyer_recovery";
const GUEST_CLAIM_SECONDS = 2 * 60 * 60;

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generateClaimToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashClaimToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookieValue(): string | null {
  const cookie = getRequest().headers.get("cookie");
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${GUEST_CLAIM_COOKIE}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function namedCookieValue(name: string): string | null {
  const cookie = getRequest().headers.get("cookie");
  const match = cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export async function createGuestBuyerClaim(
  db: SupabaseClient,
  paymentId: string,
  buyerId: string,
): Promise<string> {
  const token = generateClaimToken();
  const tokenHash = await hashClaimToken(token);
  const expiresAt = new Date(Date.now() + GUEST_CLAIM_SECONDS * 1000).toISOString();
  const { error } = await db.from("social_bid_guest_buyer_claims").insert({
    payment_id: paymentId,
    buyer_id: buyerId,
    token_hash: tokenHash,
    expires_at: expiresAt,
  });
  if (error) throw new Error("Guest sponsorship claim could not be prepared.");
  return token;
}

export function setGuestBuyerClaimCookie(token: string): void {
  setResponseHeader(
    "Set-Cookie",
    `${GUEST_CLAIM_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${GUEST_CLAIM_SECONDS}; HttpOnly; Secure; SameSite=Lax`,
  );
}

export async function consumeGuestBuyerClaim(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const token = cookieValue();
  if (!token || token.length > 200) return null;
  const { data, error } = await db.rpc("claim_social_bid_guest_buyer", {
    p_token_hash: await hashClaimToken(token),
    p_user_id: userId,
  });
  if (error) throw new Error("Sponsorship claim could not be completed.");
  if (data) {
    setResponseHeader(
      "Set-Cookie",
      `${GUEST_CLAIM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
  }
  return data ? String(data) : null;
}

export function recoveryClaimCookie(token: string): string {
  return `${RECOVERY_CLAIM_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`;
}

export async function consumeHistoricalBuyerClaim(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const token = namedCookieValue(RECOVERY_CLAIM_COOKIE);
  if (!token || token.length > 200) return null;
  const { data, error } = await db.rpc("claim_social_bid_historical_buyer", {
    p_token_hash: await hashClaimToken(token),
    p_user_id: userId,
  });
  if (error) throw new Error("Sponsorship recovery could not be completed.");
  setResponseHeader(
    "Set-Cookie",
    `${RECOVERY_CLAIM_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
  return data ? String(data) : null;
}
