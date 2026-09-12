import { describe, expect, test } from "bun:test";
import {
  avatarProxyUrl,
  shareCardFilename,
  shareCardPostText,
  shareCardProfileUrl,
  shareCardState,
  type ShareCardData,
} from "./share-card";

const base: ShareCardData = {
  username: "alex_macgregor",
  displayName: "Alex Macgregor",
  handle: "alexmacgregor__",
  avatarUrl: "https://pbs.twimg.com/profile_images/example.jpg",
  startingPriceCents: 1000,
  currentValueCents: null,
  globalRank: null,
  sponsorName: null,
};

describe("creator share card helpers", () => {
  test("uses market-entry copy before a sponsorship", () => {
    expect(shareCardState(base)).toBe("market-entry");
    expect(shareCardPostText(base)).toContain("entered the market");
  });

  test("uses sponsored copy only with a sponsor and current value", () => {
    const sponsored = { ...base, sponsorName: "Acme", currentValueCents: 2500 };
    expect(shareCardState(sponsored)).toBe("sponsored");
    expect(shareCardPostText(sponsored)).toContain("sponsored on Social Bid");
  });

  test("creates safe profile, filename, and avatar URLs", () => {
    expect(shareCardProfileUrl("alex name")).toBe("https://socialbid.co/u/alex%20name");
    expect(shareCardFilename("Alex Name!")).toBe("social-bid-alex-name.png");
    expect(avatarProxyUrl(base.avatarUrl)).toContain("/api/public/share-avatar?src=");
    expect(avatarProxyUrl(null)).toBeNull();
  });
});
