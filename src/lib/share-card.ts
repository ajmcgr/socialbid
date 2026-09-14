import { money } from "./format";

export type ShareCardData = {
  username: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  /** The creator's stored X bio/description, already fetched at connect time. */
  bio: string | null;
  startingPriceCents: number;
  currentValueCents: number | null;
  globalRank: number | null;
  sponsorName: string | null;
  sponsorLogoUrl: string | null;
};

export function shareCardProfileUrl(username: string): string {
  return `https://socialbid.co/u/${encodeURIComponent(username)}`;
}

export function shareCardFilename(username: string): string {
  const safe = username
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `social-bid-${safe || "creator"}.png`;
}

/** X post character limit; we stay just under it for safety. */
const X_POST_MAX_CHARS = 275;

/**
 * Cleans a stored X bio for use in a share post: trims whitespace, collapses
 * line breaks into single spaces, and returns null when nothing is left.
 * The bio text itself is preserved verbatim — never rewritten.
 */
export function cleanBioSnippet(bio: string | null | undefined): string | null {
  if (!bio) return null;
  const cleaned = bio.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Truncates a cleaned bio to `max` characters, cutting at a word boundary
 * where possible and appending "…" when truncation occurs.
 */
function truncateBio(bio: string, max: number): string {
  if (bio.length <= max) return bio;
  if (max < 8) return `${bio.slice(0, Math.max(1, max - 1))}…`;
  const slice = bio.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace >= Math.floor(max / 2) ? slice.slice(0, lastSpace) : slice;
  return `${cut}…`;
}

/**
 * Builds the share text for one template, shrinking only the bio paragraph
 * when the full post would exceed X's character limit. The @username, opening
 * bid, CTA and profile URL are never cut.
 */
function buildMarketEntryText(
  data: ShareCardData,
  parts: (bioParagraph: string | null) => string[],
): string {
  const bio = cleanBioSnippet(data.bio);
  const render = (bioParagraph: string | null) => parts(bioParagraph).join("\n\n");
  let text = render(bio);
  if (bio && text.length > X_POST_MAX_CHARS) {
    const withoutBio = render(null);
    const allowance = X_POST_MAX_CHARS - withoutBio.length - 2; // "\n\n" separator
    text = render(truncateBio(bio, Math.max(0, allowance)));
  }
  return text;
}

export const marketEntryTemplates: {
  id: string;
  render: (data: ShareCardData) => string;
}[] = [
  {
    id: "welcome",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return buildMarketEntryText(data, (bio) =>
        bio
          ? [
              bio,
              `@${handle} just entered the market.`,
              `Opening bid: ${bid}.`,
              `Who wants the spot? 👀`,
              shareCardProfileUrl(data.username),
            ]
          : [
              `Welcome @${handle} to SocialBid 🥳`,
              `Opening bid: ${bid}.`,
              `Who wants the spot? 👀`,
              shareCardProfileUrl(data.username),
            ],
      );
    },
  },
  {
    id: "new-market-entry",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return buildMarketEntryText(data, (bio) => [
        ...(bio ? [bio] : ["New market entry 👀"]),
        `@${handle} is now listed on SocialBid.`,
        `Opening bid: ${bid}.`,
        `Who's sponsoring them first?`,
        shareCardProfileUrl(data.username),
      ]);
    },
  },
  {
    id: "just-listed",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return buildMarketEntryText(data, (bio) => [
        ...(bio ? [bio] : ["Just listed 📈"]),
        `@${handle} is currently unsponsored.`,
        `Opening bid: ${bid}.`,
        `Who's taking the spot? 👀`,
        shareCardProfileUrl(data.username),
      ]);
    },
  },
  {
    id: "another-creator-enters",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      const cta = data.globalRank
        ? `Who's taking the #${data.globalRank} creator spot? 👀`
        : "Who wants the spot? 👀";
      return buildMarketEntryText(data, (bio) => [
        ...(bio ? [bio] : ["Another creator enters the market."]),
        `@${handle} is up for sponsorship.`,
        `Opening bid: ${bid}.`,
        cta,
        shareCardProfileUrl(data.username),
      ]);
    },
  },
  {
    id: "new-listing-dropped",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return buildMarketEntryText(data, (bio) => [
        ...(bio ? [bio] : ["New listing just dropped."]),
        `@${handle} has entered the market.`,
        `${bid} gets the first sponsorship spot.`,
        `Until someone outbids you.`,
        shareCardProfileUrl(data.username),
      ]);
    },
  },
];

export function randomMarketEntryShareText(data: ShareCardData): string {
  const index = Math.floor(Math.random() * marketEntryTemplates.length);
  const template = marketEntryTemplates[index];
  if (!template) {
    throw new Error(`Invalid market entry template index ${index}`);
  }
  const text = template.render(data);
  if (text.startsWith("@")) {
    throw new Error("Market entry share text must not start with @username");
  }
  return text;
}

export function shareCardPostText(data: ShareCardData): string {
  if (data.sponsorName && data.currentValueCents !== null) {
    const handleTag = data.handle ? ` (@${data.handle})` : "";
    return `${data.displayName}${handleTag} is sponsored on SocialBid.`;
  }
  const template = marketEntryTemplates[0];
  if (!template) {
    throw new Error("No market entry templates configured");
  }
  return template.render(data);
}

export function shareCardState(data: ShareCardData): "sponsored" | "market-entry" {
  return data.sponsorName && data.currentValueCents !== null ? "sponsored" : "market-entry";
}

export function highResolutionXAvatarUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "pbs.twimg.com") return url;
    parsed.pathname = parsed.pathname.replace(/_normal(?=\.[a-z0-9]+$)/i, "_400x400");
    if (
      parsed.pathname.includes("/profile_images/") &&
      !/_\d+x\d+\.[a-z0-9]+$/i.test(parsed.pathname)
    ) {
      parsed.searchParams.set("name", "large");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function avatarProxyUrl(url: string | null): string | null {
  const highResolutionUrl = highResolutionXAvatarUrl(url);
  return highResolutionUrl
    ? `/api/public/share-avatar?src=${encodeURIComponent(highResolutionUrl)}`
    : null;
}

export function sponsorLogoProxyUrl(url: string | null): string | null {
  return url ? `/api/public/share-avatar?kind=sponsor&src=${encodeURIComponent(url)}` : null;
}
