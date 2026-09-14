import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/$username")({
  loader: async ({ params }) => {
    throw redirect({ to: "/u/$username", params: { username: params.username }, statusCode: 302 });
  },
  head: () => ({
    meta: [
      { title: "Creator profile — SocialBid" },
      {
        name: "description",
        content: "View and sponsor this creator on SocialBid.",
      },
      { property: "og:title", content: "Creator profile — SocialBid" },
      {
        property: "og:description",
        content: "View and sponsor this creator on SocialBid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => null,
  errorComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-extrabold">Couldn't resolve this link.</h1>
    </div>
  ),
});
