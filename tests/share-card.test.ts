import { describe, expect, test } from "bun:test";
import {
  avatarProxyUrl,
  highResolutionXAvatarUrl,
  marketEntryTemplates,
  randomMarketEntryShareText,
  shareCardFilename,
  shareCardPostText,
  shareCardProfileUrl,
  shareCardState,
  sponsorLogoProxyUrl,
  type ShareCardData,
} from "../src/lib/share-card";

const base: ShareCardData = {
  username: "alex_macgregor",
  displayName: "Alex Macgregor",
  handle: "alexmacgregor__",
  avatarUrl: "https://pbs.twimg.com/profile_images/example.jpg",
  startingPriceCents: 1000,
  currentValueCents: null,
  globalRank: null,
  sponsorName: null,
  sponsorLogoUrl: null,
};

describe("creator share card helpers", () => {
  test("uses market-entry copy before a sponsorship", () => {
    expect(shareCardState(base)).toBe("market-entry");
    const text = shareCardPostText(base);
    expect(text.startsWith("@")).toBe(false);
    expect(text).toContain("@alexmacgregor__");
    expect(text).toContain("$10");
    expect(text).toContain("https://socialbid.co/u/alex_macgregor");
    expect(text).not.toContain("Social Bid");
    expect(text).not.toContain("SocialBid");
    expect(text).not.toContain(base.displayName);
  });

  test("all market-entry templates avoid leading @ and include required data", () => {
    for (const template of marketEntryTemplates) {
      const text = template.render(base);
      expect(text.startsWith("@")).toBe(false);
      expect(text).toContain("@alexmacgregor__");
      expect(text).toContain("$10");
      expect(text).toContain("https://socialbid.co/u/alex_macgregor");
      expect(text).toContain("\n\n");
      expect(text).not.toContain("Social Bid");
      expect(text).not.toContain("SocialBid");
    }
  });

  test("random market-entry selection can produce different templates", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(randomMarketEntryShareText(base));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(marketEntryTemplates.length);
  });

  test("market-entry X intent URL is properly encoded", () => {
    const text = marketEntryTemplates[0].render(base);
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    expect(url).toContain(encodeURIComponent("https://socialbid.co/u/alex_macgregor"));
    expect(url).toContain(encodeURIComponent("@alexmacgregor__"));
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
  });

  test("uses sponsored copy only with a sponsor and current value", () => {
    const sponsored = { ...base, sponsorName: "Acme", currentValueCents: 2500 };
    expect(shareCardState(sponsored)).toBe("sponsored");
    expect(shareCardPostText(sponsored)).toContain("sponsored on Social Bid");
    expect(shareCardPostText(sponsored).startsWith("@")).toBe(false);
  });

  test("creates safe profile, filename, and avatar URLs", () => {
    expect(shareCardProfileUrl("alex name")).toBe("https://socialbid.co/u/alex%20name");
    expect(shareCardFilename("Alex Name!")).toBe("social-bid-alex-name.png");
    expect(avatarProxyUrl(base.avatarUrl)).toContain("/api/public/share-avatar?src=");
    expect(avatarProxyUrl(null)).toBeNull();
    expect(sponsorLogoProxyUrl("https://project.supabase.co/logo.png")).toContain("kind=sponsor");
  });

  test("requests a crisp X avatar instead of the small normal image", () => {
    expect(
      highResolutionXAvatarUrl("https://pbs.twimg.com/profile_images/1234/avatar_normal.jpg"),
    ).toBe("https://pbs.twimg.com/profile_images/1234/avatar_400x400.jpg");
  });
});
