import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const emptyInput = z.object({});
const emailInput = z.object({ email: z.string().trim().email().max(160) });

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function currentCanonicalUser() {
  const [{ admin }, { resolveCreatorSession }] = await Promise.all([
    import("./db.server"),
    import("./creator-session.server"),
  ]);
  const db = admin();
  const session = await resolveCreatorSession(db);
  if (!session) return null;
  const { data, error } = await db.auth.admin.getUserById(session.userId);
  if (error || !data.user) return null;
  return { db, session, user: data.user };
}

export const getSignInMethods = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emptyInput.parse(input))
  .handler(async () => {
    const current = await currentCanonicalUser();
    if (!current) return null;
    const { isDeliverableEmail } = await import("./validate");
    const providers = new Set((current.user.identities ?? []).map((identity) => identity.provider));
    const { data: creator } = await current.db
      .from("creators")
      .select("id")
      .eq("user_id", current.session.userId)
      .maybeSingle();
    return {
      x: Boolean(creator),
      google: providers.has("google"),
      email: isDeliverableEmail(current.user.email) ? current.user.email!.toLowerCase() : null,
    };
  });

/**
 * Exchanges the existing HttpOnly SocialBid session for a one-use native
 * Supabase session token for the exact same auth.users row. The browser then
 * uses Supabase's authenticated linkIdentity endpoint; no user id is accepted
 * from the client.
 */
export const prepareGoogleIdentityLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emptyInput.parse(input))
  .handler(async () => {
    const current = await currentCanonicalUser();
    if (!current?.user.email) return { error: "Session expired. Sign in again." } as const;
    if (current.user.identities?.some((identity) => identity.provider === "google")) {
      return { alreadyLinked: true as const };
    }
    const generated = await current.db.auth.admin.generateLink({
      type: "magiclink",
      email: current.user.email,
    });
    const tokenHash = generated.data?.properties?.hashed_token;
    if (generated.error || !tokenHash) {
      console.error("SocialBid provider-link session preparation failed", {
        code: generated.error?.code ?? "missing_token",
      });
      return { error: "We couldn't start Google linking. Please try again." } as const;
    }
    return { tokenHash } as const;
  });

export const requestSignInEmailLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailInput.parse(input))
  .handler(async ({ data }) => {
    const current = await currentCanonicalUser();
    if (!current) return { error: "Session expired. Sign in again." } as const;
    const [{ isDeliverableEmail }, { baseUrl }, { sendSignInMethodLinkEmail }] = await Promise.all([
      import("./validate"),
      import("./db.server"),
      import("./email.server"),
    ]);
    const email = data.email.trim().toLowerCase();
    if (!isDeliverableEmail(email)) return { error: "Enter a valid email address." } as const;
    if (current.user.email?.toLowerCase() === email) return { alreadyLinked: true as const };

    const token = randomToken();
    const [emailHash, tokenHash] = await Promise.all([sha256(email), sha256(token)]);
    const { data: result, error } = await current.db.rpc("reserve_social_bid_email_identity_link", {
      p_user_id: current.session.userId,
      p_email: email,
      p_email_hash: emailHash,
      p_token_hash: tokenHash,
    });
    if (error) {
      console.error("SocialBid email sign-in linking reservation failed", { code: error.code });
      return { error: "We couldn't add that email. Please try again." } as const;
    }
    if (result === "conflict") {
      return { error: "That email is already linked to another account." } as const;
    }
    if (result !== "reserved") return { error: "Enter a valid email address." } as const;

    const actionLink = `${baseUrl()}/api/public/link-email?token=${encodeURIComponent(token)}`;
    const delivered = await sendSignInMethodLinkEmail({
      to: email,
      actionLink,
      idempotencyKey: `auth-link-email:${tokenHash}`,
    });
    if (!delivered.sent) return { error: "We couldn't send the verification email." } as const;
    return { sent: true as const };
  });
