import type { SupabaseClient } from "@supabase/supabase-js";

export type CanonicalAccount = {
  userId: string;
  email: string | null;
  source: "creator_session" | "supabase" | "both";
};

/**
 * Resolves every supported SocialBid credential to one canonical auth.users id.
 * If two credentials are present they must identify the same account; otherwise
 * authorization fails closed instead of combining identities from two users.
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

  if (creatorSession && authUser && creatorSession.userId !== authUser.id) {
    throw new Error("Conflicting SocialBid account credentials.");
  }
  const userId = creatorSession?.userId ?? authUser?.id;
  if (!userId) return null;

  const deliverableAuthEmail =
    authUser?.email_confirmed_at && authUser.email && !authUser.email.endsWith(".invalid")
      ? authUser.email.trim().toLowerCase()
      : null;
  return {
    userId,
    email: deliverableAuthEmail,
    source: creatorSession && authUser ? "both" : creatorSession ? "creator_session" : "supabase",
  };
}
