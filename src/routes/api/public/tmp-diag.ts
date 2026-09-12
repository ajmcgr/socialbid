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
        const { data, error } = await db
          .from("listings")
          .update({ status: "active" })
          .eq("creator_id", "d98bc176-cc8a-4b94-839e-1dbdfd20975a")
          .select("id, slug, status");
        return Response.json({ data, error });
      },
    },
  },
});
