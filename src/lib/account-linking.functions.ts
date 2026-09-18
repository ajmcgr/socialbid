import { createServerFn } from "@tanstack/react-start";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";

const emptyInput = z.object({});
const emailInput = z.object({ email: z.string().trim().email().max(160) });
const completeInput = z.object({
  accessToken: z.string().min(20).max(4096),
  linkToken: z.string().min(20).max(200),
});
const callbackFailureInput = z.object({
  provider: z.literal("google"),
  errorCode: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/),
});

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

function hasProvider(user: User, provider: string) {
  return Boolean(
    user.identities?.some((identity) => identity.provider === provider) ||
    user.app_metadata?.provider === provider ||
    (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes(provider)),
  );
}

async function currentCanonicalUser() {
  const [{ admin }, { resolveCreatorSession }] = await Promise.all([
    import("./db.server"),
    import("./creator-session.server"),
  ]);
  const db = admin();
  const session = await resolveCreatorSession(db);
  if (!session) return null;
  const { data: mappings, error } = await db
    .from("social_bid_account_auth_users")
    .select("auth_user_id")
    .eq("canonical_user_id", session.userId);
  if (error) throw new Error("SocialBid sign-in methods could not be resolved.");
  const authUserIds = new Set([
    session.userId,
    ...(mappings ?? []).map((row) => String(row.auth_user_id)),
  ]);
  const users: User[] = [];
  for (const authUserId of authUserIds) {
    const { data, error: userError } = await db.auth.admin.getUserById(authUserId);
    if (userError || !data.user) throw new Error("SocialBid sign-in method is unavailable.");
    users.push(data.user);
  }
  return { db, session, users };
}

async function createLinkIntent(
  current: NonNullable<Awaited<ReturnType<typeof currentCanonicalUser>>>,
  provider: "google" | "email",
  emailHash: string | null,
) {
  const linkToken = randomToken();
  const tokenHash = await sha256(linkToken);
  const { error } = await current.db.from("social_bid_account_link_intents").insert({
    canonical_user_id: current.session.userId,
    session_id: current.session.id,
    provider,
    token_hash: tokenHash,
    email_hash: emailHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error("SocialBid account-link intent could not be created.");
  return linkToken;
}

export const getSignInMethods = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emptyInput.parse(input))
  .handler(async () => {
    const current = await currentCanonicalUser();
    if (!current) return null;
    const { isDeliverableEmail } = await import("./validate");
    const { data: creator } = await current.db
      .from("creators")
      .select("id")
      .eq("user_id", current.session.userId)
      .maybeSingle();
    const deliverableEmail = current.users
      .map((user) => user.email?.trim().toLowerCase() ?? null)
      .find((email): email is string => Boolean(email && isDeliverableEmail(email)));
    return {
      x: Boolean(creator),
      google: current.users.some((user) => hasProvider(user, "google")),
      email: deliverableEmail ?? null,
    };
  });

/** Creates a single-use intent; Google itself proves the second Auth user. */
export const prepareGoogleIdentityLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emptyInput.parse(input))
  .handler(async () => {
    try {
      const current = await currentCanonicalUser();
      if (!current) return { error: "Session expired. Sign in again." } as const;
      if (current.users.some((user) => hasProvider(user, "google"))) {
        return { alreadyLinked: true as const };
      }
      return { linkToken: await createLinkIntent(current, "google", null) } as const;
    } catch (error) {
      console.error("SocialBid Google account-link preparation failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return { error: "We couldn't start Google linking. Please try again." } as const;
    }
  });

/** Records a provider callback failure without accepting or logging provider error details. */
export const reportCanonicalLinkCallbackFailure = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => callbackFailureInput.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, { resolveCreatorSession }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
    ]);
    if (!(await resolveCreatorSession(admin()))) return { ok: false as const };
    console.error("SocialBid account-link callback failed", {
      stage: "provider_callback",
      provider: data.provider,
      code: data.errorCode,
    });
    return { ok: true as const };
  });

/**
 * Sends a native Supabase magic-link credential for the requested mailbox,
 * bound to a private SocialBid account-link intent and the current HttpOnly
 * session. No Auth identity is moved or inferred from an email match.
 */
export const requestSignInEmailLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => emailInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const current = await currentCanonicalUser();
      if (!current) return { error: "Session expired. Sign in again." } as const;
      const [{ isDeliverableEmail }, { baseUrl }, { sendSignInMethodLinkEmail }] =
        await Promise.all([import("./validate"), import("./db.server"), import("./email.server")]);
      const email = data.email.trim().toLowerCase();
      if (!isDeliverableEmail(email)) return { error: "Enter a valid email address." } as const;
      if (current.users.some((user) => user.email?.trim().toLowerCase() === email)) {
        return { alreadyLinked: true as const };
      }

      const linkToken = await createLinkIntent(current, "email", await sha256(email));
      let generated = await current.db.auth.admin.generateLink({ type: "magiclink", email });
      if (generated.error || !generated.data?.properties?.hashed_token) {
        const created = await current.db.auth.admin.createUser({ email, email_confirm: false });
        if (created.error && !/already|registered|exists/i.test(created.error.message)) {
          throw created.error;
        }
        generated = await current.db.auth.admin.generateLink({ type: "magiclink", email });
      }
      const tokenHash = generated.data?.properties?.hashed_token;
      if (generated.error || !tokenHash) throw generated.error ?? new Error("missing token");

      const query = new URLSearchParams({
        token_hash: tokenHash,
        type: "magiclink",
        next: "/creator",
        link_token: linkToken,
      });
      const delivered = await sendSignInMethodLinkEmail({
        to: email,
        actionLink: `${baseUrl()}/auth?${query.toString()}`,
        idempotencyKey: `auth-link-email:${await sha256(linkToken)}`,
      });
      if (!delivered.sent) return { error: "We couldn't send the verification email." } as const;
      return { sent: true as const };
    } catch (error) {
      console.error("SocialBid email account-link preparation failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return { error: "We couldn't add that email. Please try again." } as const;
    }
  });

/**
 * Completes a link only when the current first-party session proves the target
 * SocialBid account and the supplied Supabase token proves the second Auth
 * user/provider. The client never supplies a canonical account id.
 */
export const completeCanonicalAccountLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => completeInput.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, sessionModule, { isDeliverableEmail }, { setResponseHeader }] =
      await Promise.all([
        import("./db.server"),
        import("./creator-session.server"),
        import("./validate"),
        import("@tanstack/react-start/server"),
      ]);
    const db = admin();
    const session = await sessionModule.resolveCreatorSession(db);
    if (!session) {
      console.error("SocialBid account-link completion failed", {
        stage: "canonical_session",
        code: "session_required",
      });
      return { ok: false as const, error: "session_required" as const };
    }
    const { data: authData, error: authError } = await db.auth.getUser(data.accessToken);
    if (authError || !authData.user) {
      console.error("SocialBid account-link completion failed", {
        stage: "provider_identity",
        code: authError?.code ?? "missing_user",
      });
      return { ok: false as const, error: "invalid" as const };
    }

    const tokenHash = await sha256(data.linkToken);
    const { data: intent, error: intentError } = await db
      .from("social_bid_account_link_intents")
      .select("canonical_user_id, session_id, provider, email_hash, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (
      intentError ||
      !intent ||
      intent.used_at ||
      intent.session_id !== session.id ||
      intent.canonical_user_id !== session.userId ||
      new Date(intent.expires_at).getTime() <= Date.now()
    ) {
      console.error("SocialBid account-link completion failed", {
        stage: "link_intent",
        code: intentError?.code ?? (!intent ? "missing" : "invalid_or_expired"),
      });
      return { ok: false as const, error: "invalid" as const };
    }

    const provider = String(intent.provider) as "google" | "email";
    let emailHash: string | null = null;
    if (provider === "google") {
      if (!hasProvider(authData.user, "google")) {
        console.error("SocialBid account-link completion failed", {
          stage: "provider_binding",
          code: "provider_mismatch",
        });
        return { ok: false as const, error: "provider_mismatch" as const };
      }
    } else {
      const email = authData.user.email?.trim().toLowerCase() ?? "";
      if (!authData.user.email_confirmed_at || !isDeliverableEmail(email)) {
        console.error("SocialBid account-link completion failed", {
          stage: "provider_binding",
          code: "email_unverified",
        });
        return { ok: false as const, error: "provider_mismatch" as const };
      }
      emailHash = await sha256(email);
      if (emailHash !== intent.email_hash) {
        console.error("SocialBid account-link completion failed", {
          stage: "provider_binding",
          code: "email_mismatch",
        });
        return { ok: false as const, error: "provider_mismatch" as const };
      }
    }

    const { data: result, error } = await db.rpc("complete_social_bid_account_link", {
      p_token_hash: tokenHash,
      p_authenticated_user_id: authData.user.id,
      p_session_id: session.id,
      p_provider: provider,
      p_email_hash: emailHash,
    });
    if (error) {
      console.error("SocialBid account-link completion failed", {
        stage: "canonical_mapping_rpc",
        code: error.code,
      });
      return { ok: false as const, error: "failed" as const };
    }
    if (result === "conflict") {
      console.error("SocialBid account-link completion failed", {
        stage: "canonical_mapping",
        code: "conflict",
      });
      return { ok: false as const, error: "conflict" as const };
    }
    if (result !== "linked" && result !== "already_linked") {
      console.error("SocialBid account-link completion failed", {
        stage: "canonical_mapping",
        code: "invalid_result",
      });
      return { ok: false as const, error: "invalid" as const };
    }

    const cookie = await sessionModule.issueCreatorSession(db, session.userId);
    setResponseHeader("Set-Cookie", cookie);
    return { ok: true as const };
  });
