import { admin, publicDb } from "./db.server";
import { nextPriceCents } from "./format";
import { MESSAGE_MAX_CHARS } from "./placement";
import type { ListingView, OwnerView } from "./listing.functions";

export type MarketplaceSort = "most-valuable" | "trending" | "new" | "affordable";

const TRENDING_ACTIVITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const TRENDING_DISCOVERY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type MarketplaceRow = ListingView & {
  globalRank: number | null;
  bioValueCents: number | null;
  sponsorClickCount: number;
  listedAt: string;
  latestTakeoverAt: string | null;
};

export type MarketplaceActivity = {
  id: string;
  type: "takeover" | "listed";
  creatorName: string;
  username: string;
  handle: string;
  companyName: string | null;
  previousOwner: string | null;
  amountCents: number | null;
  globalRank: number | null;
  happenedAt: string;
};

export type MarketplaceSnapshot = {
  sort: MarketplaceSort;
  rows: MarketplaceRow[];
  unowned: MarketplaceRow[];
  activity: MarketplaceActivity[];
  ownedCount: number;
  totalMarketValueCents: number;
  totalSponsorshipsCents: number;
  /** The server could not reach the market source; this is not an empty market. */
  sourceUnavailable?: boolean;
};

type CreatorRow = {
  id: string;
  display_name: string;
  username: string;
  bio: string | null;
  profile_image_url: string | null;
  social_platform: string;
  social_handle: string | null;
  social_profile_url: string | null;
  verification_status: string;
  x_account_verified: boolean | null;
  x_bio_verified: boolean | null;
  x_username: string | null;
  x_profile_url: string | null;
  x_profile_image_url: string | null;
  x_follower_count: number | null;
  x_bio_snapshot: string | null;
  banned: boolean;
};

type ListingRow = {
  id: string;
  creator_id: string;
  slug: string;
  status: string;
  starting_price_cents: number;
  minimum_increase_percentage: number | string;
  created_at: string;
};

type OwnershipRow = OwnerView & {
  listing_id: string;
  payment_id: string | null;
  bio_message?: string | null;
  placement_format?: string | null;
};

/**
 * Keeps Trending grounded in paid sponsorships while giving brand-new listings
 * a modest discovery boost. An active sponsorship always starts above the
 * maximum unsponsored freshness boost; value and a recent takeover then raise
 * the sponsored listing further.
 */
function trendingScore(row: MarketplaceRow, now: number) {
  const freshness = (timestamp: string, windowMs: number) =>
    Math.max(0, 1 - (now - new Date(timestamp).getTime()) / windowMs);

  if (!row.owner || row.bioValueCents === null) {
    return freshness(row.listedAt, TRENDING_DISCOVERY_WINDOW_MS) * 10;
  }

  const recentActivity = row.latestTakeoverAt
    ? freshness(row.latestTakeoverAt, TRENDING_ACTIVITY_WINDOW_MS) * 50
    : 0;
  return 100 + row.bioValueCents / 100 + recentActivity;
}

/**
 * Builds every public market surface from payment-backed facts. Starting prices
 * are discovery metadata only and can never create Bio Value or leaderboard rank.
 */
export async function loadMarketplace(sort: MarketplaceSort): Promise<MarketplaceSnapshot> {
  // Live deployments use the service role so ownerships can be proven against
  // applied, live-mode payments. Lovable previews intentionally do not expose
  // that secret, but they do have the public Supabase configuration. Public
  // tables are enough to render the existing settled marketplace rows there.
  let db;
  let canVerifyPayments = true;
  try {
    db = admin();
  } catch {
    db = publicDb();
    canVerifyPayments = false;
  }
  const [listingResult, creatorResult] = await Promise.all([
    db
      .from("listings")
      .select(
        "id, creator_id, slug, status, starting_price_cents, minimum_increase_percentage, created_at",
      )
      .eq("status", "active")
      .order("created_at", { ascending: false }),
    db
      .from("creators")
      .select(
        "id, display_name, username, bio, profile_image_url, social_platform, social_handle, social_profile_url, verification_status, x_account_verified, x_bio_verified, x_username, x_profile_url, x_profile_image_url, x_follower_count, x_bio_snapshot, banned",
      )
      .eq("banned", false),
  ]);

  const creators = new Map(((creatorResult.data ?? []) as CreatorRow[]).map((c) => [c.id, c]));
  const listings = ((listingResult.data ?? []) as ListingRow[]).filter((l) =>
    creators.has(l.creator_id),
  );
  const listingIds = listings.map((l) => l.id);

  const ownershipResult = listingIds.length
    ? await db
        .from("ownerships")
        .select(
          "id, listing_id, payment_id, company_name, destination_url, logo_url, amount_cents, started_at, ended_at, click_count, status, bio_message, placement_format",
        )
        .in("listing_id", listingIds)
        .order("started_at", { ascending: false })
        .limit(1000)
    : { data: [] };
  const ownerships = (ownershipResult.data ?? []) as OwnershipRow[];
  const paymentIds = [...new Set(ownerships.flatMap((o) => (o.payment_id ? [o.payment_id] : [])))];

  // If the provenance migration has not been applied yet, this query returns no
  // eligible payments. Failing closed is intentional: unverifiable value is not value.
  const paymentResult =
    canVerifyPayments && paymentIds.length
      ? await db
          .from("payments")
          .select("id, status, refund_status, stripe_livemode")
          .in("id", paymentIds)
          .eq("status", "applied")
          .eq("stripe_livemode", true)
          .neq("refund_status", "refunded")
      : { data: [] };
  const eligiblePaymentIds = new Set(
    ((paymentResult.data ?? []) as Array<{ id: string }>).map((p) => p.id),
  );
  const genuineOwnerships = canVerifyPayments
    ? ownerships.filter(
        (o) => Boolean(o.payment_id) && eligiblePaymentIds.has(o.payment_id as string),
      )
    : ownerships.filter((o) => Boolean(o.payment_id));

  const ownersByListing = new Map<string, OwnershipRow[]>();
  for (const ownership of genuineOwnerships) {
    const current = ownersByListing.get(ownership.listing_id) ?? [];
    current.push(ownership);
    ownersByListing.set(ownership.listing_id, current);
  }

  const allRows: MarketplaceRow[] = listings.map((listing) => {
    const creator = creators.get(listing.creator_id)!;
    const ownershipHistory = ownersByListing.get(listing.id) ?? [];
    const canBuy = listing.status === "active" && Boolean(creator.x_account_verified);
    const owner = canBuy ? (ownershipHistory.find((o) => o.status === "active") ?? null) : null;
    const history = ownershipHistory.filter((o) => o.status !== "active");
    const increase = Number(listing.minimum_increase_percentage);
    return {
      creator: {
        id: creator.id,
        display_name: creator.display_name,
        username: creator.username,
        bio: creator.bio,
        profile_image_url: creator.x_profile_image_url ?? creator.profile_image_url,
        social_platform: creator.social_platform,
        social_handle: creator.social_handle,
        social_profile_url: creator.social_profile_url,
        verification_status: creator.verification_status,
        x_account_verified: creator.x_account_verified,
        x_bio_verified: creator.x_bio_verified,
        x_username: creator.x_username,
        x_profile_url: creator.x_profile_url,
        x_follower_count: creator.x_follower_count,
        x_bio_snapshot: creator.x_bio_snapshot,
      },
      listing: {
        id: listing.id,
        slug: listing.slug,
        status: listing.status,
        starting_price_cents: listing.starting_price_cents,
        minimum_increase_percentage: increase,
      },
      owner,
      history,
      requiredPriceCents: owner
        ? nextPriceCents(owner.amount_cents, increase)
        : listing.starting_price_cents,
      canBuy,
      globalRank: null,
      bioValueCents: owner?.amount_cents ?? null,
      sponsorClickCount: owner?.click_count ?? 0,
      retainedBioChars: 0,
      messageCharLimit: MESSAGE_MAX_CHARS,
      listedAt: listing.created_at,
      latestTakeoverAt: owner?.started_at ?? history[0]?.started_at ?? null,
    };
  });

  const owned = allRows
    .filter((row) => row.owner && row.bioValueCents !== null)
    .sort((a, b) => {
      const valueDelta = (b.bioValueCents ?? 0) - (a.bioValueCents ?? 0);
      if (valueDelta !== 0) return valueDelta;
      return (
        new Date(a.latestTakeoverAt ?? 0).getTime() - new Date(b.latestTakeoverAt ?? 0).getTime()
      );
    });
  owned.forEach((row, index) => {
    row.globalRank = index + 1;
  });

  const unowned = allRows
    .filter((row) => !row.owner)
    .sort((a, b) => a.requiredPriceCents - b.requiredPriceCents);

  let rows: MarketplaceRow[];
  switch (sort) {
    case "trending":
      {
        const now = Date.now();
        rows = [...allRows].sort((a, b) => {
          const scoreDelta = trendingScore(b, now) - trendingScore(a, now);
          if (scoreDelta !== 0) return scoreDelta;
          return new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime();
        });
      }
      break;
    case "new":
      rows = [...allRows].sort(
        (a, b) => new Date(b.listedAt).getTime() - new Date(a.listedAt).getTime(),
      );
      break;
    case "affordable":
      rows = [...allRows].sort((a, b) => a.requiredPriceCents - b.requiredPriceCents);
      break;
    case "most-valuable":
      rows = owned;
      break;
  }

  const rowByListing = new Map(allRows.map((row) => [row.listing.id, row]));
  const takeoverActivity: MarketplaceActivity[] = genuineOwnerships.map((ownership) => {
    const row = rowByListing.get(ownership.listing_id)!;
    const chronological = [...(ownersByListing.get(ownership.listing_id) ?? [])].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime(),
    );
    const position = chronological.findIndex((item) => item.id === ownership.id);
    const previousOwner = position > 0 ? (chronological[position - 1]?.company_name ?? null) : null;
    return {
      id: ownership.id,
      type: "takeover",
      creatorName: row.creator.display_name,
      username: row.creator.username,
      handle: row.creator.x_username ?? row.creator.social_handle ?? row.creator.username,
      companyName: ownership.company_name,
      previousOwner,
      amountCents: ownership.amount_cents,
      globalRank: ownership.status === "active" ? row.globalRank : null,
      happenedAt: ownership.started_at,
    };
  });
  const listingActivity: MarketplaceActivity[] = unowned.map((row) => ({
    id: `listing-${row.listing.id}`,
    type: "listed",
    creatorName: row.creator.display_name,
    username: row.creator.username,
    handle: row.creator.x_username ?? row.creator.social_handle ?? row.creator.username,
    companyName: null,
    previousOwner: null,
    amountCents: row.listing.starting_price_cents,
    globalRank: null,
    happenedAt: row.listedAt,
  }));
  const activity = [...takeoverActivity, ...listingActivity]
    .sort((a, b) => new Date(b.happenedAt).getTime() - new Date(a.happenedAt).getTime())
    .slice(0, 12);

  return {
    sort,
    rows,
    unowned,
    activity,
    ownedCount: owned.length,
    totalMarketValueCents: owned.reduce((sum, row) => sum + (row.bioValueCents ?? 0), 0),
    totalSponsorshipsCents: genuineOwnerships.reduce(
      (sum, ownership) => sum + ownership.amount_cents,
      0,
    ),
  };
}
