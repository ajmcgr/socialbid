import type { SupabaseClient } from "@supabase/supabase-js";

export type CanonicalAccount = {
  userId: string;
  authUserId: string;
  email: string | null;
  source: "creator_session" | "supabase" | "both";
};

export async function resolveSocialBidAccountId(
  db: SupabaseClient,
  authUserId: string,
  options: { createIfMissing?: boolean } = {},
): Promise<string | null> {
  const rpcName = options.createIfMissing
    ? "ensure_social_bid_account"
    : "resolve_social_bid_account";
  const { data, error } = await db.rpc(rpcName, { p_auth_user_id: authUserId });
  if (error) throw new Error("SocialBid account mapping could not be resolved.");
  return data ? String(data) : null;
}

/**
 * Resolves every supported SocialBid credential through the private,
 * app-specific account mapping. Multiple independently proven Supabase Auth
 * users may therefore resolve to the same SocialBid ownership principal while
 * their shared-project Auth identities remain intact.
 */
export async function resolveCanonicalAccount(
  db: SupabaseClient,
  accessToken?: string | null,
): Promise<CanonicalAccount | null> {
  const { resolveCreatorSession } = await import("./creator-session.server");
  const creatorSession = await resolveCreatorSession(db);

  let authUser: { id: string; email?: string | null; email_confirmed_at?: string | null } | null =
    null;
  if (accessToken) {
    const { data, error } = await db.auth.getUser(accessToken);
    if (!error && data.user) authUser = data.user;
  }

  const authAccountId = authUser
    ? await resolveSocialBidAccountId(db, authUser.id, { createIfMissing: true })
    : null;

  if (creatorSession && authAccountId && creatorSession.userId !== authAccountId) {
    throw new Error("Conflicting SocialBid account credentials.");
  }
  const userId = creatorSession?.userId ?? authAccountId;
  if (!userId) return null;

  const deliverableAuthEmail =
    authUser?.email_confirmed_at && authUser.email && !authUser.email.endsWith(".invalid")
      ? authUser.email.trim().toLowerCase()
      : null;
  return {
    userId,
    authUserId: authUser?.id ?? userId,
    email: deliverableAuthEmail,
    source: creatorSession && authUser ? "both" : creatorSession ? "creator_session" : "supabase",
  };
}
