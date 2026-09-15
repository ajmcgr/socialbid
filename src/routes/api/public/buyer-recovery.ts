import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/buyer-recovery")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        if (token.length < 20 || token.length > 200) {
          return new Response(null, { status: 302, headers: { Location: "/inbox" } });
        }
        const { recoveryClaimCookie } = await import("@/lib/account-claims.server");
        return new Response(null, {
          status: 302,
          headers: { Location: "/inbox", "Set-Cookie": recoveryClaimCookie(token) },
        });
      },
    },
  },
});
