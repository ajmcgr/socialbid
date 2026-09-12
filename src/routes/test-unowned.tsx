import { createFileRoute } from "@tanstack/react-router";
import { MarketplaceLeaderboard } from "@/components/MarketplaceLeaderboard";
import type { MarketplaceSnapshot } from "@/lib/marketplace.server";

function makeRow(index: number) {
  return {
    creator: {
      id: `creator-${index}`,
      display_name: `Creator ${index}`,
      username: `creator${index}`,
      bio: null,
      profile_image_url: null,
      social_platform: "x",
      social_handle: `creator${index}`,
      social_profile_url: `https://x.com/creator${index}`,
      verification_status: "verified",
      x_account_verified: true,
      x_bio_verified: true,
      x_username: `creator${index}`,
      x_profile_url: `https://x.com/creator${index}`,
      x_follower_count: 100 + index,
    },
    listing: {
      id: `listing-${index}`,
      slug: `creator${index}`,
      status: "published",
      starting_price_cents: 500 + index * 100,
      minimum_increase_percentage: 20,
    },
    owner: null,
    history: [],
    requiredPriceCents: 500 + index * 100,
    canBuy: true,
    globalRank: null,
    bioValueCents: null,
    sponsorClickCount: 0,
    listedAt: new Date().toISOString(),
    latestTakeoverAt: null,
  } as any;
}

const mockMarket: MarketplaceSnapshot = {
  sort: "most-valuable",
  rows: [],
  unowned: Array.from({ length: 12 }, (_, i) => makeRow(i + 1)),
  activity: [],
  ownedCount: 0,
  totalMarketValueCents: 0,
  totalSponsorshipsCents: 0,
};

export const Route = createFileRoute("/test-unowned")({
  component: () => <MarketplaceLeaderboard market={mockMarket} page={1} />,
});
