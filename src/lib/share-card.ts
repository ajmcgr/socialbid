import { money } from "./format";

export type ShareCardData = {
  username: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
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

export const marketEntryTemplates: {
  id: string;
  render: (data: ShareCardData) => string;
}[] = [
  {
    id: "new-market-entry",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return `New market entry 👀\n\n@${handle} just entered the market.\n\nOpening bid: ${bid}.\n\nWho wants the spot?\n\n${shareCardProfileUrl(data.username)}`;
    },
  },
  {
    id: "just-listed",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return `Just listed 📈\n\n@${handle} is now on the market.\n\nOpening bid: ${bid}.\n\nWho's sponsoring them first?\n\n${shareCardProfileUrl(data.username)}`;
    },
  },
  {
    id: "another-creator-enters",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return `Another creator enters the market.\n\n@${handle} is currently unsponsored.\n\nOpening bid: ${bid}.\n\nWho's taking the spot? 👀\n\n${shareCardProfileUrl(data.username)}`;
    },
  },
  {
    id: "another-listing",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents);
      return `The market just got another listing.\n\n@${handle}\n\nOpening bid: ${bid}.\n\nAny takers? 👀\n\n${shareCardProfileUrl(data.username)}`;
    },
  },
  {
    id: "new-listing-dropped",
    render: (data) => {
      const handle = data.handle ?? data.username;
      const bid = money(data.startingPriceCents).replace(/^\$/, "");
      return `New listing just dropped.\n\n@${handle} has entered the market.\n\n$${bid} gets the first sponsorship spot.\n\nUntil someone outbids you.\n\n${shareCardProfileUrl(data.username)}`;
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
    return `${data.displayName}${handleTag} is sponsored on Social Bid.`;
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
