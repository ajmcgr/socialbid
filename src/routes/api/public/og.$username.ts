import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/og/$username")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const username = params.username.trim();
        if (!username || username.length > 40) {
          return new Response("Not found", { status: 404 });
        }

        try {
          const { getListing } = await import("@/lib/listing.functions");
          const view = await getListing({ data: { username } });
          if (!view) return new Response("Not found", { status: 404 });

          const { renderCreatorOgPng } = await import("@/lib/creator-og.server");
          const png = await renderCreatorOgPng(view, request.url);
          return new Response(Uint8Array.from(png).buffer, {
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
              "Content-Length": String(png.byteLength),
              "X-Content-Type-Options": "nosniff",
            },
          });
        } catch (error) {
          console.error("creator OG image failed", {
            username,
            error: error instanceof Error ? error.message : "unknown",
          });
          return new Response("Image unavailable", { status: 500 });
        }
      },
    },
  },
});
