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
      const { data: link, error } = await db.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo: "https://socialbid.co/reset-password" },
      });
      if (error || !link?.properties?.action_link) {
        console.error("generateLink failed", error);
        return { ok: true } as const;
      }
      const { sendPasswordResetEmail } = await import("./email.server");
      await sendPasswordResetEmail({
        to: email,
        actionLink: link.properties.action_link,
        idempotencyKey: `pwd-reset:${email}:${Date.now()}`,
      });
    } catch (e) {
      console.error("password reset failed", e);
    }
    return { ok: true } as const;
  });
