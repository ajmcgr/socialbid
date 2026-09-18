import { admin } from "./db.server";

export type Gate =
  { ok: true; userId: string; email: string | null } | { ok: false; error: string };

export async function requireUser(token: string): Promise<Gate> {
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data.user) return { ok: false, error: "Not signed in." };
  return { ok: true, userId: data.user.id, email: data.user.email ?? null };
}

export async function requireAdmin(token: string): Promise<Gate> {
  const user = await requireUser(token);
  if (!user.ok) return user;
  const db = admin();
  const { data: canonicalUserId, error: mappingError } = await db.rpc(
    "resolve_social_bid_account",
    { p_auth_user_id: user.userId },
  );
  if (mappingError) return { ok: false, error: "Admins only." };
  const roleUserId = canonicalUserId ? String(canonicalUserId) : user.userId;
  const { data } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", roleUserId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) return { ok: false, error: "Admins only." };
  return { ...user, userId: roleUserId };
}
