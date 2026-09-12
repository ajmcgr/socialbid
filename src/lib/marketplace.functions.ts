import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { MarketplaceSnapshot, MarketplaceSort } from "./marketplace.server";

const sortSchema = z.enum(["most-valuable", "trending", "new", "affordable"]);

function emptyMarketplace(sort: MarketplaceSort): MarketplaceSnapshot {
  return {
    sort,
    rows: [],
    unowned: [],
    activity: [],
    ownedCount: 0,
    totalMarketValueCents: 0,
    totalSponsorshipsCents: 0,
    sourceUnavailable: true,
  };
}

export const getMarketplace = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ sort: sortSchema.default("most-valuable") }).parse(input),
  )
  .handler(async ({ data }): Promise<MarketplaceSnapshot> => {
    const sort = data.sort as MarketplaceSort;
    try {
      const { loadMarketplace } = await import("./marketplace.server");
      return await loadMarketplace(sort);
    } catch (error) {
      // The Lovable preview environment may not have the server-only Supabase
      // credentials configured. Do not turn an unavailable data source into a
      // route-level 500: the homepage can still render its empty marketplace.
      console.error("Marketplace load failed", error);
      return emptyMarketplace(sort);
    }
  });
