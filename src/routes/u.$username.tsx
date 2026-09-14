import { createFileRoute, notFound } from "@tanstack/react-router";
import { getListing } from "@/lib/listing.functions";
import { BioListing } from "@/components/BioListing";
import { money } from "@/lib/format";

export const Route = createFileRoute("/u/$username")({
  loader: async ({ params }) => {
    const view = await getListing({ data: { username: params.username } });
    if (!view) throw notFound();
    return view;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [] };
    const name = loaderData.creator.display_name;
    const sponsored = Boolean(loaderData.owner);
    const title = sponsored ? `${name} is sponsored on SocialBid` : `Sponsor ${name} on SocialBid`;
    const description = sponsored
      ? `Current sponsorship value: ${money(loaderData.bioValueCents ?? loaderData.owner!.amount_cents)}. Place the next bid to take the spot.`
      : `${name} is currently unsponsored. Opening bid: ${money(loaderData.listing.starting_price_cents)}.`;
    const canonicalUrl = `https://socialbid.co/u/${encodeURIComponent(loaderData.creator.username)}`;
    const imageVersion = sponsored
      ? `${loaderData.owner!.id}-${loaderData.owner!.amount_cents}-${loaderData.requiredPriceCents}`
      : `${loaderData.listing.id}-${loaderData.listing.starting_price_cents}`;
    const imageUrl = `https://socialbid.co/api/public/og/${encodeURIComponent(loaderData.creator.username)}?v=${encodeURIComponent(imageVersion)}`;
    const imageAlt = `${name}'s Social Bid sponsorship profile`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: canonicalUrl },
        { property: "og:image", content: imageUrl },
        { property: "og:image:secure_url", content: imageUrl },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: imageAlt },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: imageUrl },
        { name: "twitter:image:alt", content: imageAlt },
      ],
      links: [{ rel: "canonical", href: canonicalUrl }],
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
