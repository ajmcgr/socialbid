import { createFileRoute } from "@tanstack/react-router";

const ALLOWED_HOSTS = new Set(["pbs.twimg.com", "abs.twimg.com"]);

export const Route = createFileRoute("/api/public/share-avatar")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const src = new URL(request.url).searchParams.get("src");
        if (!src) return new Response("Not found", { status: 404 });

        let imageUrl: URL;
        try {
          imageUrl = new URL(src);
        } catch {
          return new Response("Invalid image URL", { status: 400 });
        }
        if (imageUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(imageUrl.hostname)) {
          return new Response("Image host not allowed", { status: 403 });
        }

        const upstream = await fetch(imageUrl, { redirect: "error" });
        const contentType = upstream.headers.get("content-type") ?? "";
        if (!upstream.ok || !upstream.body || !contentType.startsWith("image/")) {
          return new Response("Image unavailable", { status: 404 });
        }
        return new Response(upstream.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
