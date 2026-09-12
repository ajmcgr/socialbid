import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Password-reset via Resend. The Supabase project's send-email hook is
 * misconfigured, so resetPasswordForEmail fails server-side. Instead we
 * generate a recovery link with the admin API and deliver it ourselves.
 * Always returns success to avoid leaking which emails have accounts.
 */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data }) => {
    const email = data.email.trim().toLowerCase();
    try {
      const { admin } = await import("./db.server");
      const db = admin();
      let { data: link, error } = await db.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: "https://socialbid.co/reset-password" },
      });

      // A newsletter subscriber is not necessarily an Auth user. Create the
      // account first so the same "set password" flow works for them too.
      if (error || !link?.properties?.hashed_token) {
        const { error: createError } = await db.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        if (createError && !/already|registered|exists/i.test(createError.message)) {
          console.error("create password account failed", createError);
          return { ok: true } as const;
        }
        const generated = await db.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: "https://socialbid.co/reset-password" },
        });
        link = generated.data;
        error = generated.error;
      }

      const hashedToken = link?.properties?.hashed_token;
      if (error || !hashedToken) {
        console.error("generateLink failed", error);
        return { ok: true } as const;
      }
      // Build our own link so we never depend on the Supabase project's
      // Site URL / redirect allow-list (which points at another domain).
      const actionLink = `https://socialbid.co/reset-password?token_hash=${encodeURIComponent(
        hashedToken,
      )}&type=recovery`;
      const { sendPasswordResetEmail } = await import("./email.server");
      await sendPasswordResetEmail({
        to: email,
        actionLink,
        idempotencyKey: `pwd-reset:${email}:${Date.now()}`,
      });
    } catch (e) {
      console.error("password reset failed", e);
    }
    return { ok: true } as const;
  });
