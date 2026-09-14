import { Resvg } from "@cf-wasm/resvg";
import { money } from "./format";
import type { ListingView } from "./listing.functions";
import { highResolutionXAvatarUrl } from "./share-card";

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_REMOTE_IMAGE_BYTES = 2_000_000;

type OgRuntime = typeof globalThis & {
  __socialBidOgFont?: Promise<Uint8Array>;
};

const runtime = globalThis as OgRuntime;

function loadFont(requestUrl: string) {
  if (!runtime.__socialBidOgFont) {
    runtime.__socialBidOgFont = fetch(new URL("/inter-variable.ttf", requestUrl))
      .then(async (response) => {
        if (!response.ok) throw new Error(`OG font returned ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error) => {
        delete runtime.__socialBidOgFont;
        throw error;
      });
  }
  return runtime.__socialBidOgFont;
}

function escapeXml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&apos;",
      '"': "&quot;",
    };
    return entities[character] ?? character;
  });
}

function truncate(value: string, length: number) {
  const characters = Array.from(value.trim());
  return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : value.trim();
}

function allowedAvatarUrl(value: string | null) {
  const highResolutionUrl = highResolutionXAvatarUrl(value);
  if (!highResolutionUrl) return null;
  try {
    const url = new URL(highResolutionUrl);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "pbs.twimg.com" && url.hostname !== "abs.twimg.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function fetchAvatar(value: string | null) {
  const url = allowedAvatarUrl(value);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) return null;
    const mimeType = response.headers.get("content-type")!.split(";", 1)[0];
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function creatorCardSvg(view: ListingView, avatarUrl: string | null) {
  const creator = view.creator;
  const sponsored = Boolean(view.owner);
  const handle = (creator.x_username ?? creator.social_handle ?? creator.username).replace(
    /^@/,
    "",
  );
  const status = sponsored ? "SPONSORED" : "UNSPONSORED";
  const valueLabel = sponsored ? "Current value" : "Opening bid";
  const value = money(
    sponsored
      ? (view.bioValueCents ?? view.owner!.amount_cents)
      : view.listing.starting_price_cents,
  );
  const detail = sponsored ? `Next bid ${money(view.requiredPriceCents)}` : "Be the first sponsor";
  const sponsor = sponsored
    ? `Sponsored by ${truncate(view.owner!.company_name, 42)}`
    : "Open for sponsorship";
  const initial = truncate(creator.display_name, 1).toUpperCase();
  const avatar = avatarUrl
    ? `<image href="${escapeXml(avatarUrl)}" x="86" y="190" width="184" height="184" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
    : `<rect x="86" y="190" width="184" height="184" fill="#64ed70"/><text x="178" y="314" text-anchor="middle" font-size="92" font-weight="800" fill="#0b0808">${escapeXml(initial)}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs><clipPath id="avatarClip"><rect x="86" y="190" width="184" height="184"/></clipPath></defs>
    <rect width="1200" height="630" fill="#fbfaf7"/>
    <rect x="34" y="34" width="1132" height="562" fill="#ffffff" stroke="#0b0808" stroke-width="4"/>
    <path d="M78 76 L128 70 L124 116 L105 116 L82 136 L86 116 Z" fill="#0b0808"/>
    <text x="148" y="116" font-size="40" font-weight="800" fill="#0b0808">social bid</text>
    ${avatar}
    <text x="308" y="229" font-size="25" font-weight="700" letter-spacing="2" fill="#2867ce">${status}</text>
    <text x="308" y="292" font-size="54" font-weight="800" fill="#0b0808">${escapeXml(truncate(creator.display_name, 32))}</text>
    <text x="308" y="337" font-size="28" font-weight="500" fill="#6b6865">@${escapeXml(truncate(handle, 40))}</text>
    <text x="308" y="389" font-size="25" font-weight="600" fill="#0b0808">${escapeXml(sponsor)}</text>
    <line x1="82" y1="432" x2="1118" y2="432" stroke="#0b0808" stroke-width="3"/>
    <text x="86" y="480" font-size="22" font-weight="700" letter-spacing="1.5" fill="#6b6865">${valueLabel.toUpperCase()}</text>
    <text x="82" y="558" font-size="72" font-weight="800" fill="#0b0808">${escapeXml(value)}</text>
    <rect x="802" y="474" width="316" height="82" rx="2" fill="#2867ce"/>
    <text x="960" y="526" text-anchor="middle" font-size="27" font-weight="700" fill="#ffffff">${escapeXml(detail)}</text>
  </svg>`;
}

export async function renderCreatorOgPng(view: ListingView, requestUrl: string) {
  const [font, avatar] = await Promise.all([
    loadFont(requestUrl),
    fetchAvatar(view.creator.profile_image_url),
  ]);

  const svg = creatorCardSvg(view, avatar);
  const renderer = await Resvg.async(svg, {
    background: "#fbfaf7",
    font: { fontBuffers: [font], defaultFontFamily: "Inter", loadSystemFonts: false },
  });
  return renderer.render().asPng();
}
