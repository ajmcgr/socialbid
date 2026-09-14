import { createFileRoute, notFound } from "@tanstack/react-router";
import { getListing } from "@/lib/listing.functions";
import { BioListing } from "@/components/BioListing";

export const Route = createFileRoute("/u/$username")({
  loader: async ({ params }) => {
    const view = await getListing({ data: { username: params.username } });
    if (!view) throw notFound();
    return view;
  },
  head: ({ loaderData }) => {
    const name = loaderData?.creator.display_name ?? "this creator";
    const handle = loaderData?.creator.social_handle ?? loaderData?.creator.username ?? "";
    const title = `Sponsor @${handle} — SocialBid`;
    const description = `Sponsor ${name} on SocialBid. Your message and link stay on their profile until somebody pays more.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: CreatorProfile,
  errorComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-extrabold">Couldn't load this profile.</h1>
    </div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-extrabold">No such creator profile.</h1>
      <p className="mt-2 text-muted-foreground">This creator isn't listed.</p>
    </div>
  ),
});

function CreatorProfile() {
  return <BioListing view={Route.useLoaderData()} heading={false} />;
}
