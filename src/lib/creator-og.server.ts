import jpeg from "jpeg-js";
import opentype from "opentype.js";
import { money } from "./format";
import type { ListingView } from "./listing.functions";
import { highResolutionXAvatarUrl } from "./share-card";

const WIDTH = 1200;
const HEIGHT = 630;
const MAX_REMOTE_IMAGE_BYTES = 2_000_000;

type Point = { x: number; y: number };
type Raster = { width: number; height: number; data: Uint8Array };
type OgRuntime = typeof globalThis & { __socialBidOgFont?: Promise<opentype.Font> };
const runtime = globalThis as OgRuntime;

function loadFont(requestUrl: string) {
  if (!runtime.__socialBidOgFont) {
    runtime.__socialBidOgFont = fetch(new URL("/inter-variable.ttf", requestUrl))
      .then(async (response) => {
        if (!response.ok) throw new Error(`OG font returned ${response.status}`);
        return opentype.parse(await response.arrayBuffer());
      })
      .catch((error) => {
        delete runtime.__socialBidOgFont;
        throw error;
      });
  }
  return runtime.__socialBidOgFont;
}

function truncate(value: string, length: number) {
  const characters = Array.from(value.trim());
  return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : value.trim();
}

function rgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255, 255] as const;
}

function fillRect(
  raster: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
) {
  const [red, green, blue, alpha] = rgb(color);
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(raster.width, Math.ceil(x + width));
  const bottom = Math.min(raster.height, Math.ceil(y + height));
  for (let row = top; row < bottom; row += 1) {
    for (let column = left; column < right; column += 1) {
      const offset = (row * raster.width + column) * 4;
      raster.data[offset] = red;
      raster.data[offset + 1] = green;
      raster.data[offset + 2] = blue;
      raster.data[offset + 3] = alpha;
    }
  }
}

function fillContours(raster: Raster, contours: Point[][], color: string) {
  const points = contours.flat();
  if (!points.length) return;
  const minY = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))));
  const maxY = Math.min(raster.height - 1, Math.ceil(Math.max(...points.map((point) => point.y))));

  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections: number[] = [];
    for (const contour of contours) {
      for (let index = 0; index < contour.length; index += 1) {
        const first = contour[index]!;
        const second = contour[(index + 1) % contour.length]!;
        if ((first.y <= scanY && second.y > scanY) || (second.y <= scanY && first.y > scanY)) {
          intersections.push(
            first.x + ((scanY - first.y) * (second.x - first.x)) / (second.y - first.y),
          );
        }
      }
    }
    intersections.sort((first, second) => first - second);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const left = intersections[index]!;
      const right = intersections[index + 1]!;
      fillRect(raster, left, y, right - left, 1, color);
    }
  }
}

function textContours(font: opentype.Font, value: string, x: number, y: number, size: number) {
  const contours: Point[][] = [];
  let contour: Point[] = [];
  let current: Point = { x, y };
  const closeContour = () => {
    if (contour.length > 2) contours.push(contour);
    contour = [];
  };

  for (const command of font.getPath(value, x, y, size).commands) {
    if (command.type === "M") {
      closeContour();
      current = { x: command.x, y: command.y };
      contour.push(current);
    } else if (command.type === "L") {
      current = { x: command.x, y: command.y };
      contour.push(current);
    } else if (command.type === "Q") {
      const start = current;
      for (let step = 1; step <= 8; step += 1) {
        const t = step / 8;
        const inverse = 1 - t;
        contour.push({
          x: inverse * inverse * start.x + 2 * inverse * t * command.x1 + t * t * command.x,
          y: inverse * inverse * start.y + 2 * inverse * t * command.y1 + t * t * command.y,
        });
      }
      current = { x: command.x, y: command.y };
    } else if (command.type === "C") {
      const start = current;
      for (let step = 1; step <= 10; step += 1) {
        const t = step / 10;
        const inverse = 1 - t;
        contour.push({
          x:
            inverse ** 3 * start.x +
            3 * inverse * inverse * t * command.x1 +
            3 * inverse * t * t * command.x2 +
            t ** 3 * command.x,
          y:
            inverse ** 3 * start.y +
            3 * inverse * inverse * t * command.y1 +
            3 * inverse * t * t * command.y2 +
            t ** 3 * command.y,
        });
      }
      current = { x: command.x, y: command.y };
    } else if (command.type === "Z") {
      closeContour();
    }
  }
  closeContour();
  return contours;
}

function drawText(
  raster: Raster,
  font: opentype.Font,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  fillContours(raster, textContours(font, value, x, y, size), color);
}

function drawCenteredText(
  raster: Raster,
  font: opentype.Font,
  value: string,
  centerX: number,
  y: number,
  size: number,
  color: string,
) {
  const width = font.getAdvanceWidth(value, size);
  drawText(raster, font, value, centerX - width / 2, y, size, color);
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

async function fetchAvatar(value: string | null): Promise<Raster | null> {
  const url = allowedAvatarUrl(value);
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.byteLength > MAX_REMOTE_IMAGE_BYTES) return null;
    const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  } catch {
    return null;
  }
}

function drawImage(
  raster: Raster,
  image: Raster,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  for (let targetY = 0; targetY < height; targetY += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((targetY / height) * image.height));
    for (let targetX = 0; targetX < width; targetX += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((targetX / width) * image.width));
      const sourceOffset = (sourceY * image.width + sourceX) * 4;
      const targetOffset = ((y + targetY) * raster.width + x + targetX) * 4;
      raster.data.set(image.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
  }
}

function drawCreatorCard(view: ListingView, font: opentype.Font, avatar: Raster | null) {
  const raster: Raster = { width: WIDTH, height: HEIGHT, data: new Uint8Array(WIDTH * HEIGHT * 4) };
  const creator = view.creator;
  const sponsored = Boolean(view.owner);
  const handle = (creator.x_username ?? creator.social_handle ?? creator.username).replace(
    /^@/,
    "",
  );
  const value = money(
    sponsored
      ? (view.bioValueCents ?? view.owner!.amount_cents)
      : view.listing.starting_price_cents,
  );

  fillRect(raster, 0, 0, WIDTH, HEIGHT, "#fbfaf7");
  fillRect(raster, 34, 34, 1132, 562, "#ffffff");
  fillRect(raster, 34, 34, 1132, 4, "#0b0808");
  fillRect(raster, 34, 592, 1132, 4, "#0b0808");
  fillRect(raster, 34, 34, 4, 562, "#0b0808");
  fillRect(raster, 1162, 34, 4, 562, "#0b0808");
  fillContours(
    raster,
    [
      [
        { x: 78, y: 76 },
        { x: 128, y: 70 },
        { x: 124, y: 116 },
        { x: 105, y: 116 },
        { x: 82, y: 136 },
        { x: 86, y: 116 },
      ],
    ],
    "#0b0808",
  );
  drawText(raster, font, "social bid", 148, 116, 40, "#0b0808");

  if (avatar) {
    drawImage(raster, avatar, 86, 190, 184, 184);
  } else {
    fillRect(raster, 86, 190, 184, 184, "#64ed70");
    drawCenteredText(
      raster,
      font,
      Array.from(creator.display_name.trim())[0]?.toUpperCase() ?? "?",
      178,
      316,
      82,
      "#0b0808",
    );
  }

  drawText(raster, font, sponsored ? "SPONSORED" : "UNSPONSORED", 308, 229, 25, "#2867ce");
  drawText(raster, font, truncate(creator.display_name, 32), 308, 292, 54, "#0b0808");
  drawText(raster, font, `@${truncate(handle, 40)}`, 308, 337, 28, "#6b6865");
  drawText(
    raster,
    font,
    sponsored ? `Sponsored by ${truncate(view.owner!.company_name, 42)}` : "Open for sponsorship",
    308,
    389,
    25,
    "#0b0808",
  );
  fillRect(raster, 82, 432, 1036, 3, "#0b0808");
  drawText(raster, font, sponsored ? "CURRENT VALUE" : "OPENING BID", 86, 480, 22, "#6b6865");
  drawText(raster, font, value, 82, 558, 72, "#0b0808");
  fillRect(raster, 802, 474, 316, 82, "#2867ce");
  drawCenteredText(
    raster,
    font,
    sponsored ? `Next bid ${money(view.requiredPriceCents)}` : "Be the first sponsor",
    960,
    526,
    27,
    "#ffffff",
  );
  return raster;
}

function uint32(value: number) {
  return new Uint8Array([
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ]);
}

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatenate(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = new TextEncoder().encode(type);
  const body = concatenate([typeBytes, data]);
  return concatenate([uint32(data.byteLength), body, uint32(crc32(body))]);
}

async function encodePng(raster: Raster) {
  const scanlines = new Uint8Array((raster.width * 4 + 1) * raster.height);
  for (let row = 0; row < raster.height; row += 1) {
    const targetOffset = row * (raster.width * 4 + 1);
    scanlines[targetOffset] = 0;
    scanlines.set(
      raster.data.subarray(row * raster.width * 4, (row + 1) * raster.width * 4),
      targetOffset + 1,
    );
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = concatenate([
    uint32(raster.width),
    uint32(raster.height),
    new Uint8Array([8, 6, 0, 0, 0]),
  ]);
  return concatenate([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

export async function renderCreatorOgPng(view: ListingView, requestUrl: string) {
  const [font, avatar] = await Promise.all([
    loadFont(requestUrl),
    fetchAvatar(view.creator.profile_image_url),
  ]);
  return encodePng(drawCreatorCard(view, font, avatar));
}
