import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/x-start")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { xConfigured, pkce, randomToken, authorizeUrl, encodeXOAuthState, safeXOAuthNext } =
          await import("@/lib/x.server");
        const { admin, baseUrl } = await import("@/lib/db.server");
        if (!xConfigured()) {
          return new Response(null, {
            status: 302,
            headers: { Location: "/creator?error=x_not_configured" },
          });
        }

        const state = randomToken(24);
        const { verifier, challenge } = await pkce();
        const db = admin();
        const { resolveCreatorSession } = await import("@/lib/creator-session.server");
        const currentSession = await resolveCreatorSession(db);
        const next = safeXOAuthNext(new URL(request.url).searchParams.get("next"));
        const { error } = await db.from("x_oauth_states").insert({
          state,
          code_verifier: encodeXOAuthState({
            verifier,
            linkUserId: currentSession?.userId ?? null,
            next,
          }),
        });
        if (error) {
          console.error("X OAuth state creation failed", { code: error.code });
          return new Response(null, {
            status: 302,
            headers: { Location: "/creator?error=x_callback_error" },
          });
        }

        return new Response(null, {
          status: 302,
          headers: { Location: authorizeUrl(baseUrl(), state, challenge) },
        });
      },
    },
  },
});
