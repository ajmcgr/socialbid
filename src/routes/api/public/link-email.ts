import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/link-email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { admin } = await import("@/lib/db.server");
        const { resolveCreatorSession } = await import("@/lib/creator-session.server");
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const redirect = (result: string) =>
          new Response(null, {
            status: 302,
            headers: { Location: `/creator?email_link=${encodeURIComponent(result)}` },
          });
        if (token.length < 20 || token.length > 200) return redirect("invalid");

        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const tokenHash = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("");
        const db = admin();
        const session = await resolveCreatorSession(db);
        if (!session) return redirect("session_required");

        const { data: link, error: lookupError } = await db
          .from("social_bid_email_identity_links")
          .select("id, user_id, email, expires_at, used_at")
          .eq("token_hash", tokenHash)
          .eq("user_id", session.userId)
          .maybeSingle();
        if (
          lookupError ||
          !link ||
          link.used_at ||
          new Date(link.expires_at).getTime() <= Date.now()
        ) {
          return redirect("invalid");
        }

        const { error: updateError } = await db.auth.admin.updateUserById(session.userId, {
          email: String(link.email),
          email_confirm: true,
        });
        if (updateError) {
          const conflict = /already|registered|exists/i.test(updateError.message);
          console.error("SocialBid email sign-in linking failed", {
            code: updateError.code,
            conflict,
          });
          return redirect(conflict ? "conflict" : "failed");
        }

        const { error: consumeError } = await db
          .from("social_bid_email_identity_links")
          .update({ used_at: new Date().toISOString() })
          .eq("id", link.id)
          .is("used_at", null);
        if (consumeError) {
          console.error("SocialBid email sign-in link finalization failed", {
            code: consumeError.code,
          });
        }
        return redirect("success");
      },
    },
  },
});
