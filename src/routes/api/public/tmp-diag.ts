import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/tmp-diag")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== "diag-9f2a") {
          return new Response("no", { status: 404 });
        }
        const { admin } = await import("@/lib/db.server");
        const db = admin();
        const { data: creators } = await db
          .from("creators")
          .select(
            "id, display_name, username, x_username, banned, x_account_verified, profile_image_url, x_profile_image_url",
          )
          .or("x_username.ilike.%yeonji%,x_username.ilike.%GadgetFreak%");
        const ids = (creators ?? []).map((c: { id: string }) => c.id);
        const { data: listings } = ids.length
          ? await db.from("listings").select("*").in("creator_id", ids)
          : { data: [] };
        return Response.json({ creators, listings });
      },
    },
  },
});
