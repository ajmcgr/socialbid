import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/link-email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Retired after canonical account mapping shipped. Old links must not
        // mutate a shared Supabase Auth user; new links prove the mailbox in
        // /auth and map that Auth user to the existing SocialBid account.
        void request;
        return new Response(null, {
          status: 302,
          headers: { Location: "/creator?email_link=invalid" },
        });
      },
    },
  },
});
