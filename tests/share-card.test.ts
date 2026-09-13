import { describe, expect, test } from "bun:test";
import {
  avatarProxyUrl,
  cleanBioSnippet,
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
  bio: "Builder of internet markets. Founder at Social Bid.",
  startingPriceCents: 1000,
  currentValueCents: null,
  globalRank: null,
  sponsorName: null,
  sponsorLogoUrl: null,
};

const X_LIMIT = 280;

describe("creator share card helpers", () => {
  test("uses market-entry copy before a sponsorship", () => {
    expect(shareCardState(base)).toBe("market-entry");
    const text = shareCardPostText(base);
    expect(text.startsWith("@")).toBe(false);
    expect(text).toContain("@alexmacgregor__");
    expect(text).toContain("Builder of internet markets.");
    expect(text).toContain("$10");
    expect(text).toContain("https://socialbid.co/u/alex_macgregor");
  });

  test("all market-entry templates include bio, bid, CTA and URL, never lead with @", () => {
    for (const template of marketEntryTemplates) {
      const text = template.render(base);
      expect(text.startsWith("@")).toBe(false);
      expect(text).toContain("@alexmacgregor__");
      expect(text).toContain("Builder of internet markets. Founder at Social Bid.");
      expect(text).toContain("$10");
      expect(text).toContain("https://socialbid.co/u/alex_macgregor");
      expect(text).toContain("\n\n");
      expect(text.length).toBeLessThanOrEqual(X_LIMIT);
    }
  });

  test("welcome template starts with Welcome and uses SocialBid branding", () => {
    const welcome = marketEntryTemplates.find((t) => t.id === "welcome");
    expect(welcome).toBeDefined();
    const text = welcome!.render(base);
    expect(text.startsWith("Welcome @alexmacgregor__ to SocialBid 🥳")).toBe(true);
    expect(text).toContain("Opening bid: $10.");
    expect(text).toContain("Who wants the spot? 👀");
  });

  test("templates render five distinct openings", () => {
    const openings = new Set(marketEntryTemplates.map((t) => t.render(base).split("\n")[0]));
    expect(openings.size).toBe(5);
  });

  test("long bios are truncated with an ellipsis and the post stays within the limit", () => {
    const longBio = "word ".repeat(200).trim();
    for (const template of marketEntryTemplates) {
      const text = template.render({ ...base, bio: longBio });
      expect(text.length).toBeLessThanOrEqual(X_LIMIT);
      expect(text).toContain("…");
      expect(text.startsWith("@")).toBe(false);
      // Critical content is never cut.
      expect(text).toContain("@alexmacgregor__");
      expect(text).toContain("$10");
      expect(text).toContain("https://socialbid.co/u/alex_macgregor");
    }
  });

  test("multiline bios collapse into a single paragraph", () => {
    const text = marketEntryTemplates[0]!.render({
      ...base,
      bio: "  Line one.\n\nLine two.\n   Line three.  ",
    });
    expect(text).toContain("Line one. Line two. Line three.");
    expect(text).not.toContain("Line one.\n");
  });

  test("emoji in bios are preserved", () => {
    const text = marketEntryTemplates[0]!.render({
      ...base,
      bio: "16 y/o dev 🚀 shipping daily 🔥",
    });
    expect(text).toContain("16 y/o dev 🚀 shipping daily 🔥");
  });

  test("missing bio is omitted gracefully with no blank paragraph", () => {
    for (const template of marketEntryTemplates) {
      for (const bio of [null, "", "   "]) {
        const text = template.render({ ...base, bio });
        expect(text.startsWith("@")).toBe(false);
        expect(text).not.toContain("undefined");
        expect(text).not.toContain("null");
        expect(text).not.toMatch(/\n\n\n/);
        expect(text).toContain("@alexmacgregor__");
        expect(text).toContain("$10");
        expect(text).toContain("https://socialbid.co/u/alex_macgregor");
      }
    }
  });

  test("long display names and usernames still fit within the limit", () => {
    const data: ShareCardData = {
      ...base,
      username: "averyverylongusername_1234567890",
      displayName: "A Very Long Display Name That Goes On And On Forever",
      handle: "averyverylonghandle12345",
      bio: "A reasonably sized bio that describes the creator nicely.",
    };
    for (const template of marketEntryTemplates) {
      const text = template.render(data);
      expect(text.length).toBeLessThanOrEqual(X_LIMIT);
      expect(text.startsWith("@")).toBe(false);
      expect(text).toContain(`https://socialbid.co/u/${data.username}`);
    }
  });

  test("random market-entry selection can produce different templates", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      seen.add(randomMarketEntryShareText(base));
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(seen.size).toBeLessThanOrEqual(marketEntryTemplates.length);
  });

  test("market-entry X intent URL is properly encoded", () => {
    const text = marketEntryTemplates[0]!.render(base);
    const url = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    expect(url).toContain(encodeURIComponent("https://socialbid.co/u/alex_macgregor"));
    expect(url).toContain(encodeURIComponent("@alexmacgregor__"));
    expect(url.startsWith("https://x.com/intent/post?text=")).toBe(true);
  });

  test("cleanBioSnippet trims, collapses whitespace and rejects empty input", () => {
    expect(cleanBioSnippet("  hello\n world  ")).toBe("hello world");
    expect(cleanBioSnippet("   ")).toBeNull();
    expect(cleanBioSnippet("")).toBeNull();
    expect(cleanBioSnippet(null)).toBeNull();
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
