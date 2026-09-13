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

function firstParagraph(text: string): string {
  return text.split("\n\n")[0] ?? "";
}

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

  test("all five templates lead with the unchanged bio and include required dynamic data", () => {
    for (const template of marketEntryTemplates) {
      const text = template.render(base);
      expect(firstParagraph(text)).toBe(base.bio);
      expect(text.startsWith("@")).toBe(false);
      expect(text).toContain("@alexmacgregor__");
      expect(text).toContain("Builder of internet markets. Founder at Social Bid.");
      expect(text).toContain("$10");
      expect(text).toContain("https://socialbid.co/u/alex_macgregor");
      expect(text).toContain("\n\n");
      expect(text.length).toBeLessThanOrEqual(X_LIMIT);
    }
  });

  test("first variation uses the bio before its market-entry language", () => {
    const welcome = marketEntryTemplates.find((t) => t.id === "welcome");
    expect(welcome).toBeDefined();
    if (!welcome) throw new Error("Welcome template is missing");
    const text = welcome.render(base);
    expect(text.startsWith(`${base.bio}\n\n@alexmacgregor__ just entered the market.`)).toBe(true);
    expect(text).toContain("Opening bid: $10.");
    expect(text).toContain("Who wants the spot? 👀");
  });

  test("templates retain five distinct variations after the shared bio hook", () => {
    const postsWithoutBio = new Set(
      marketEntryTemplates.map((template) =>
        template.render(base).split("\n\n").slice(1).join("\n\n"),
      ),
    );
    expect(postsWithoutBio.size).toBe(5);
  });

  test("long bios are truncated with an ellipsis and the post stays within the limit", () => {
    const longBio = "word ".repeat(200).trim();
    for (const template of marketEntryTemplates) {
      const text = template.render({ ...base, bio: longBio });
      expect(text.length).toBeLessThanOrEqual(X_LIMIT);
      expect(text).toContain("…");
      expect(text.startsWith("@")).toBe(false);
      expect(firstParagraph(text).endsWith("…")).toBe(true);
      // Critical content is never cut.
      expect(text).toContain("@alexmacgregor__");
      expect(text).toContain("$10");
      expect(text).toContain("https://socialbid.co/u/alex_macgregor");
    }
  });

  test("multiline bios collapse into a single paragraph", () => {
    const template = marketEntryTemplates[0];
    if (!template) throw new Error("Market Entry template is missing");
    const text = template.render({
      ...base,
      bio: "  Line one.\n\nLine two.\n   Line three.  ",
    });
    expect(firstParagraph(text)).toBe("Line one. Line two. Line three.");
    expect(text).not.toContain("Line one.\n");
  });

  test("short, emoji, @mention and URL bios remain verbatim", () => {
    const bios = [
      "Builder.",
      "16 y/o dev 🚀 shipping daily 🔥",
      "Building with @friend every day.",
      "Notes at https://example.com/about",
    ];
    for (const bio of bios) {
      for (const template of marketEntryTemplates) {
        expect(firstParagraph(template.render({ ...base, bio }))).toBe(bio);
      }
    }
  });

  test("missing bio is omitted gracefully with no blank paragraph", () => {
    for (const template of marketEntryTemplates) {
      for (const bio of [null, "", "   "]) {
        const text = template.render({ ...base, bio });
        expect(text.startsWith("@")).toBe(false);
        expect(text).not.toContain("undefined");
        expect(text).not.toContain("null");
        expect(text).not.toMatch(/\n\n\n/);
        expect(firstParagraph(text).length).toBeGreaterThan(0);
        expect(text).toContain("@alexmacgregor__");
        expect(text).toContain("$10");
        expect(text).toContain("https://socialbid.co/u/alex_macgregor");
      }
    }
  });

  test("rank variation uses a reliable rank and falls back when unavailable", () => {
    const ranked = marketEntryTemplates.find((t) => t.id === "another-creator-enters");
    expect(ranked).toBeDefined();
    if (!ranked) throw new Error("Rank template is missing");
    expect(ranked.render({ ...base, globalRank: 50 })).toContain(
      "Who's taking the #50 creator spot? 👀",
    );
    expect(ranked.render({ ...base, globalRank: null })).toContain("Who wants the spot? 👀");
  });

  test("opening bid remains dynamic in every variation", () => {
    for (const template of marketEntryTemplates) {
      expect(template.render({ ...base, startingPriceCents: 2750 })).toContain("$27.50");
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
    const template = marketEntryTemplates[0];
    if (!template) throw new Error("Market Entry template is missing");
    const text = template.render(base);
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
