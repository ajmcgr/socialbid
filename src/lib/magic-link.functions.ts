import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const safeNext = z.enum(["/admin", "/creator", "/inbox", "/notifications"]);
const requestIn = z.object({
  email: z.string().trim().email().max(160),
  next: safeNext,
});

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates a native Supabase Auth magic-link token, but delivers it through
 * SocialBid's own Resend sender. This avoids changing the shared project's
 * global Post email template or SMTP configuration.
 */
export const requestMagicLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => requestIn.parse(input))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    try {
      const [{ admin, baseUrl }, { sendMagicLinkEmail }] = await Promise.all([
        import("./db.server"),
        import("./email.server"),
      ]);
      const db = admin();
      const emailHash = await sha256(email);
      const { data: reserved, error: reserveError } = await db.rpc(
        "reserve_social_bid_auth_email",
        { p_email_hash: emailHash },
      );
      if (reserveError) {
        console.error("SocialBid magic-link rate limit unavailable", {
          code: reserveError.code,
        });
        return { ok: false as const };
      }

      // Return the same successful response during the cooldown. This both
      // limits delivery and avoids revealing whether an account exists.
      if (!reserved) return { ok: true as const };

      let generated = await db.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${baseUrl()}/auth` },
      });

      if (generated.error || !generated.data?.properties?.hashed_token) {
        const created = await db.auth.admin.createUser({ email, email_confirm: false });
        if (created.error && !/already|registered|exists/i.test(created.error.message)) {
          console.error("SocialBid magic-link user preparation failed", {
            code: created.error.code,
          });
          return { ok: false as const };
        }
        generated = await db.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: `${baseUrl()}/auth` },
        });
      }

      const tokenHash = generated.data?.properties?.hashed_token;
      if (generated.error || !tokenHash) {
        console.error("SocialBid magic-link generation failed", {
          code: generated.error?.code ?? "missing_token",
        });
        return { ok: false as const };
      }

      const query = new URLSearchParams({
        token_hash: tokenHash,
        type: "magiclink",
        next: data.next,
      });
      const delivered = await sendMagicLinkEmail({
        to: email,
        actionLink: `${baseUrl()}/auth?${query.toString()}`,
        idempotencyKey: `auth-magic:${tokenHash}`,
      });
      return { ok: delivered.sent } as const;
    } catch (error) {
      console.error("SocialBid magic-link request failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return { ok: false as const };
    }
  });
