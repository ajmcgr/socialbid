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

        const upstream = await fetch(imageUrl, {
          redirect: "follow",
          headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*" },
        });
        let finalUrl: URL;
        try {
          finalUrl = new URL(upstream.url || imageUrl.toString());
        } catch {
          return new Response("Image unavailable", { status: 404 });
        }
        if (finalUrl.protocol !== "https:" || !ALLOWED_HOSTS.has(finalUrl.hostname)) {
          return new Response("Image redirect not allowed", { status: 403 });
        }
        const contentType = upstream.headers.get("content-type") ?? "";
        if (!upstream.ok || !upstream.body || !contentType.startsWith("image/")) {
          return new Response("Image unavailable", { status: 404 });
        }
        return new Response(upstream.body, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
