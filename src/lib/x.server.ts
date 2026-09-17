/**
 * X (Twitter) OAuth 2.0 Authorization Code flow with PKCE + API v2 lookups.
 * Server-only. Requires X_CLIENT_ID and X_CLIENT_SECRET.
 */

const AUTH_URL = "https://twitter.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const ME_URL =
  "https://api.twitter.com/2/users/me?user.fields=description,profile_image_url,public_metrics,url,name,username,entities";

/**
 * Minimum scopes for our use case: read the authenticated user's public
 * profile. No posting, no profile writes, no refresh tokens (we never act on
 * the creator's behalf after the connect flow).
 */
export const X_SCOPES = ["users.read", "tweet.read"];

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function xConfigured(): boolean {
  return Boolean(process.env["X_CLIENT_ID"] && process.env["X_CLIENT_SECRET"]);
}

export function redirectUri(base: string): string {
  return `${base}/api/public/x-callback`;
}

export const X_OAUTH_NEXT_PATHS = ["/creator", "/inbox", "/notifications", "/admin"] as const;
export type XOAuthNextPath = (typeof X_OAUTH_NEXT_PATHS)[number];

export function safeXOAuthNext(value: string | null | undefined): XOAuthNextPath {
  return X_OAUTH_NEXT_PATHS.includes(value as XOAuthNextPath)
    ? (value as XOAuthNextPath)
    : "/creator";
}

type XOAuthStateData = {
  verifier: string;
  linkUserId: string | null;
  next: XOAuthNextPath;
};

export function encodeXOAuthState(data: XOAuthStateData): string {
  return JSON.stringify(data);
}

export function decodeXOAuthState(value: string): XOAuthStateData {
  try {
    const parsed = JSON.parse(value) as Partial<XOAuthStateData>;
    if (typeof parsed.verifier === "string" && parsed.verifier.length >= 20) {
      return {
        verifier: parsed.verifier,
        linkUserId: typeof parsed.linkUserId === "string" ? parsed.linkUserId : null,
        next: safeXOAuthNext(parsed.next),
      };
    }
  } catch {
    // States created before account linking stored only the raw verifier.
  }
  return { verifier: value, linkUserId: null, next: "/creator" };
}

export function authorizeUrl(base: string, state: string, challenge: string): string {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: process.env["X_CLIENT_ID"]!,
    redirect_uri: redirectUri(base),
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${p.toString()}`;
}

function basicAuth(): string {
  return btoa(`${process.env["X_CLIENT_ID"]}:${process.env["X_CLIENT_SECRET"]}`);
}

export async function exchangeCode(base: string, code: string, verifier: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth()}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(base),
      code_verifier: verifier,
    }).toString(),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X token exchange failed [${res.status}]: ${body}`);
  return JSON.parse(body) as { access_token: string; refresh_token?: string; expires_in: number };
}

export type XUser = {
  id: string;
  username: string;
  name: string;
  description: string;
  profile_image_url: string | null;
  url: string | null;
  followers: number;
  /** Expanded t.co links in the bio/website, when X returns them. */
  expandedUrls: string[];
};

export async function fetchXUser(accessToken: string): Promise<XUser> {
  const res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`X users/me failed [${res.status}]: ${body}`);
  // X's response contains nested entity shapes that vary by field expansion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const u = (JSON.parse(body) as { data: Record<string, any> }).data;
  const entities = u["entities"] ?? {};
  const urls: string[] = [];
  for (const group of [entities?.url?.urls, entities?.description?.urls]) {
    for (const item of group ?? []) {
      if (item?.expanded_url) urls.push(String(item.expanded_url));
      if (item?.display_url) urls.push(String(item.display_url));
    }
  }
  return {
    id: String(u["id"]),
    username: String(u["username"]),
    name: String(u["name"] ?? u["username"]),
    description: String(u["description"] ?? ""),
    profile_image_url: u["profile_image_url"] ? String(u["profile_image_url"]) : null,
    url: u["url"] ? String(u["url"]) : null,
    followers: Number(u["public_metrics"]?.followers_count ?? 0),
    expandedUrls: urls,
  };
}

/** The exact placement a creator must add to their X profile. */
export function requiredPlacement(username: string): string {
  return `socialbid.co/${username}`;
}

/** True when the required Social Bid placement is currently present in the profile. */
export function placementPresent(user: XUser, username: string): boolean {
  const needle = requiredPlacement(username).toLowerCase();
  const haystack = [user.description, user.url ?? "", ...user.expandedUrls].join(" ").toLowerCase();
  return haystack.includes(needle);
}
