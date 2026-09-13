import { describe, expect, test } from "bun:test";
import {
  avatarProxyUrl,
  highResolutionXAvatarUrl,
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
    expect(text).toContain("@alexmacgregor__ just entered the market.");
    expect(text).toContain("Opening bid: $10.");
    expect(text).toContain("Who wants the spot? 👀");
    expect(text).toContain("https://socialbid.co/u/alex_macgregor");
    expect(text).not.toContain("Social Bid");
    expect(text).not.toContain("SocialBid");
    expect(text).not.toContain(base.displayName);
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
    expect(sponsorLogoProxyUrl("https://project.supabase.co/logo.png")).toContain(
      "kind=sponsor",
    );
  });

  test("requests a crisp X avatar instead of the small normal image", () => {
    expect(
      highResolutionXAvatarUrl("https://pbs.twimg.com/profile_images/1234/avatar_normal.jpg"),
    ).toBe("https://pbs.twimg.com/profile_images/1234/avatar_400x400.jpg");
  });
});
