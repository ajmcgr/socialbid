import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { z } from "zod";
import { getMarketplace } from "@/lib/marketplace.functions";
import { MarketplaceLeaderboard } from "@/components/MarketplaceLeaderboard";
import type { MarketplaceSnapshot, MarketplaceSort } from "@/lib/marketplace.server";

const sortSchema = z.enum(["most-valuable", "trending", "new", "affordable"]);

// This module is evaluated independently in the browser. It lets a transient
// route-loader failure retain the already rendered public market until a
// successful reconnect refresh replaces it.
const lastMarketBySort = new Map<MarketplaceSort, MarketplaceSnapshot>();

function rememberMarket(market: MarketplaceSnapshot) {
  if (!market.sourceUnavailable) lastMarketBySort.set(market.sort, market);
}

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    sort: sortSchema.optional().catch("most-valuable"),
    page: z.coerce.number().int().min(1).optional().catch(1),
  }),
  loaderDeps: ({ search }) => ({ sort: search.sort ?? "most-valuable" }),
  loader: async ({ deps }) => {
    try {
      const market = await getMarketplace({ data: { sort: deps.sort } });
      if (market.sourceUnavailable) throw new Error("market source unavailable");
      return market;
    } catch (error) {
      // A route refresh can fail while a laptop is waking even though the
      // browser has not yet changed navigator.onLine. Preserve an already
      // rendered market until a subsequent recovery succeeds. A first visit
      // has no cached snapshot and still reaches the normal error view.
      const cached = typeof navigator !== "undefined" ? lastMarketBySort.get(deps.sort) : undefined;
      if (cached) return cached;
      throw error;
    }
  },
  head: () => ({
    meta: [
      { title: "SocialBid — How much are you worth on X?" },
      {
        name: "description",
        content:
          "Add your X profile and let sponsors decide what you’re worth. Sponsors compete for the top sponsorship spot on SocialBid.",
      },
      { property: "og:title", content: "How much are you worth on X?" },
      {
        property: "og:description",
        content: "Add your profile. Let sponsors decide.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "How much are you worth on X?" },
    ],
  }),
  component: Home,
  errorComponent: MarketLoadError,
});

function Home() {
  const market = Route.useLoaderData();
  const { page } = Route.useSearch();

  useEffect(() => {
    rememberMarket(market);
  }, [market]);

  return <MarketplaceLeaderboard market={market} page={page ?? 1} />;
}

function MarketLoadError({ reset }: { reset: () => void }) {
  useEffect(() => {
    // AppWakeRecovery invalidates routes immediately after it emits this
    // event. Reset this boundary first so that revalidation can render.
    const recover = () => reset();
    window.addEventListener("social-bid-recover", recover);
    return () => window.removeEventListener("social-bid-recover", recover);
  }, [reset]);

  return (
    <div className="mx-auto max-w-xl px-5 py-24 text-center">
      <h1 className="text-3xl font-extrabold">The market couldn't load.</h1>
      <p className="mt-2 text-muted-foreground">
        We&apos;ll retry automatically when your connection returns.
      </p>
    </div>
  );
}
