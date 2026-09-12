export type ShareCardData = {
  username: string;
  displayName: string;
  handle: string | null;
  avatarUrl: string | null;
  startingPriceCents: number;
  currentValueCents: number | null;
  globalRank: number | null;
  sponsorName: string | null;
};

export function shareCardProfileUrl(username: string): string {
  return `https://socialbid.co/u/${encodeURIComponent(username)}`;
}

export function shareCardFilename(username: string): string {
  const safe = username.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `social-bid-${safe || "creator"}.png`;
}

export function shareCardPostText(data: ShareCardData): string {
  const handle = data.handle ? `@${data.handle}` : data.displayName;
  return data.sponsorName && data.currentValueCents !== null
    ? `${handle} is sponsored on Social Bid.`
    : `${handle} just entered the market on Social Bid.`;
}

export function shareCardState(data: ShareCardData): "sponsored" | "market-entry" {
  return data.sponsorName && data.currentValueCents !== null ? "sponsored" : "market-entry";
}

export function avatarProxyUrl(url: string | null): string | null {
  return url ? `/api/public/share-avatar?src=${encodeURIComponent(url)}` : null;
}