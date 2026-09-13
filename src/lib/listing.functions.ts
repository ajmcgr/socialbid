import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type OwnerView = {
  id: string;
  company_name: string;
  destination_url: string;
  logo_url: string | null;
  amount_cents: number;
  started_at: string;
  ended_at: string | null;
  click_count: number;
  status: string;
  payment_id?: string | null;
  bio_message?: string | null;
};

export type ListingView = {
  creator: {
    id: string;
    display_name: string;
    username: string;
    bio: string | null;
    profile_image_url: string | null;
    social_platform: string;
    social_handle: string | null;
    social_profile_url: string | null;
    verification_status: string;
    x_account_verified?: boolean | null;
    x_bio_verified?: boolean | null;
    x_username?: string | null;
    x_profile_url?: string | null;
    x_follower_count?: number | null;
    x_bio_snapshot?: string | null;
  };
  listing: {
    id: string;
    slug: string;
    status: string;
    starting_price_cents: number;
    minimum_increase_percentage: number;
  };
  owner: OwnerView | null;
  history: OwnerView[];
  requiredPriceCents: number;
  canBuy: boolean;
  globalRank?: number | null;
  bioValueCents?: number | null;
  /** Length of the creator's own bio text, excluding the current sponsored placement. */
  retainedBioChars?: number;
  /** Characters the next sponsor may use for their message (before their URL is known). */
  messageCharLimit?: number;
};

export const getListing = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ username: z.string().min(1).max(40) }).parse(input),
  )
  .handler(async ({ data }): Promise<ListingView | null> => {
    const { loadMarketplace } = await import("./marketplace.server");
    const market = await loadMarketplace("new");
    const username = data.username.toLowerCase();
    return (
      [...market.rows, ...market.unowned].find(
        (row, index, all) =>
          row.creator.username.toLowerCase() === username &&
          all.findIndex((candidate) => candidate.listing.id === row.listing.id) === index,
      ) ?? null
    );
  });

export const getOwnership = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { publicDb } = await import("./db.server");
    const db = publicDb();
    const { data: o } = await db
      .from("ownerships")
      .select(
        "id, listing_id, company_name, destination_url, logo_url, amount_cents, started_at, ended_at, status, click_count",
      )
      .eq("id", data.id)
      .maybeSingle();
    if (!o) return null;
    const { data: listing } = await db
      .from("listings")
      .select("id, slug, creator_id")
      .eq("id", o.listing_id)
      .maybeSingle();
    const { data: creator } = listing
      ? await db
          .from("creators")
          .select("display_name, username, social_handle")
          .eq("id", listing.creator_id)
          .maybeSingle()
      : { data: null };
    return { ownership: o, creator, slug: listing?.slug ?? null };
  });

export const trackEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().min(1).max(60),
        listingId: z.string().uuid().optional(),
        props: z.record(z.any()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { admin } = await import("./db.server");
    await admin()
      .from("analytics_events")
      .insert({ name: data.name, listing_id: data.listingId ?? null, props: data.props ?? {} });
    return { ok: true };
  });
