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

export function shareCardPostText(data: ShareCardData): string {
  if (data.sponsorName && data.currentValueCents !== null) {
    const handleTag = data.handle ? ` (@${data.handle})` : "";
    return `${data.displayName}${handleTag} is sponsored on Social Bid.`;
  }
  const handle = data.handle ?? data.username;
  const profileUrl = shareCardProfileUrl(data.username);
  const openingBid = money(data.startingPriceCents);
  return `@${handle} just entered the market.\n\nOpening bid: ${openingBid}.\n\nWho wants the spot? 👀\n\n${profileUrl}`;
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
