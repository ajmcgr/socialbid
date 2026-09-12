import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, Download, ExternalLink, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import {
  avatarProxyUrl,
  highResolutionXAvatarUrl,
  shareCardFilename,
  shareCardPostText,
  shareCardProfileUrl,
  shareCardState,
  sponsorLogoProxyUrl,
  type ShareCardData,
} from "@/lib/share-card";

const SIZE = 1200;
const INK = "#05060a";
const PAPER = "#ffffff";
const PAPER_BG = "#fbfaf8";
const GREEN = "#67eb72";

const DISPLAY = "Arial Black, Inter, sans-serif";
const MONO = "'Courier New', monospace";

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
  font = DISPLAY,
  weight = 800,
  minSize = 24,
) {
  let size = maxSize;
  while (size > minSize) {
    context.font = `${weight} ${size}px ${font}`;
    if (context.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

function ellipsize(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth)
    value = value.slice(0, -1);
  return `${value}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) resolve(image);
      else reject(new Error("Avatar image is empty"));
    };
    image.onerror = reject;
    image.src = src;
  });
}

async function loadAvatar(url: string | null): Promise<HTMLImageElement | null> {
  const direct = highResolutionXAvatarUrl(url);
  const sources = [avatarProxyUrl(url), direct].filter(
    (source, index, values): source is string =>
      Boolean(source) && values.indexOf(source) === index,
  );
  for (const source of sources) {
    try {
      return await loadImage(source);
    } catch {
      // Fall back to the original X CDN URL if the proxy is temporarily unavailable.
    }
  }
  return null;
}

async function loadSponsorLogo(url: string | null): Promise<HTMLImageElement | null> {
  const sources = [sponsorLogoProxyUrl(url), url].filter(
    (source, index, values): source is string =>
      Boolean(source) && values.indexOf(source) === index,
  );
  for (const source of sources) {
    try {
      return await loadImage(source);
    } catch {
      // The designed unsponsored/sponsor-name mark remains available as a fallback.
    }
  }
  return null;
}

function drawCoverImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const drawnWidth = image.naturalWidth * scale;
  const drawnHeight = image.naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawnWidth) / 2,
    y + (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
}

function drawContainImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / naturalWidth, height / naturalHeight);
  const drawnWidth = naturalWidth * scale;
  const drawnHeight = naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawnWidth) / 2,
    y + (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  );
}

function drawAvatarFallback(
  context: CanvasRenderingContext2D,
  data: ShareCardData,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save();
  context.fillStyle = INK;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `800 320px ${DISPLAY}`;
  context.fillText(
    data.displayName.trim().slice(0, 1).toUpperCase() || "S",
    x + width / 2,
    y + height / 2,
  );
  context.restore();
}

async function drawCard(canvas: HTMLCanvasElement, data: ShareCardData) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const sponsored = shareCardState(data) === "sponsored";
  context.clearRect(0, 0, SIZE, SIZE);

  // Poster background: green gradient.
  const gradient = context.createLinearGradient(0, 0, SIZE, SIZE);
  gradient.addColorStop(0, GREEN);
  gradient.addColorStop(1, "#38833e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, SIZE, SIZE);

  // Inner card frame.
  const pad = 44;
  const cardW = SIZE - pad * 2;
  context.strokeStyle = INK;
  context.lineWidth = 4;
  context.strokeRect(pad, pad, cardW, SIZE - pad * 2);

  // Header: status kicker + brand mark.
  context.fillStyle = INK;
  context.textBaseline = "middle";
  context.font = `800 40px ${DISPLAY}`;
  context.fillText(sponsored ? "SPONSORSHIP NEWS" : "MARKET ENTRY", pad + 44, pad + 62);

  try {
    const brand = await loadImage("/social-bid-logo.png");
    drawContainImage(
      context,
      brand,
      brand.naturalWidth,
      brand.naturalHeight,
      SIZE - pad - 44 - 300,
      pad + 62 - 36,
      300,
      72,
    );
  } catch {
    context.textAlign = "right";
    context.fillStyle = INK;
    context.font = `800 40px ${DISPLAY}`;
    context.fillText("SOCIAL BID", SIZE - pad - 44, pad + 62);
    context.textAlign = "left";
  }

  // Portrait panel.
  const px = pad + 44;
  const py = pad + 118;
  const pw = cardW - 88;
  const ph = 640;
  context.save();
  context.beginPath();
  context.rect(px, py, pw, ph);
  context.clip();
  const avatar = await loadAvatar(data.avatarUrl);
  let portraitX = px;
  let portraitY = py;
  let portraitW = pw;
  let portraitH = ph;
  if (avatar) {
    portraitW = ph * 0.86;
    portraitX = px + (pw - portraitW) / 2;
    drawCoverImage(context, avatar, portraitX, portraitY, portraitW, portraitH);
  } else {
    context.fillStyle = "#e8e6e1";
    context.fillRect(px, py, pw, ph);
    drawAvatarFallback(context, data, px, py, pw, ph);
  }
  context.restore();
  context.strokeStyle = INK;
  context.lineWidth = 4;
  context.strokeRect(portraitX, portraitY, portraitW, portraitH);

  // Sponsor badge floating over the portrait.
  const badgeW = 420;
  const badgeH = 152;
  const badgeX = SIZE / 2 - badgeW / 2;
  const badgeY = py + ph - badgeH - 34;
  context.fillStyle = PAPER;
  context.fillRect(badgeX, badgeY, badgeW, badgeH);
  context.strokeStyle = INK;
  context.lineWidth = 4;
  context.strokeRect(badgeX, badgeY, badgeW, badgeH);

  const sponsorLogo = sponsored ? await loadSponsorLogo(data.sponsorLogoUrl) : null;
  const sponsorName = sponsored ? (data.sponsorName ?? "Sponsored").toUpperCase() : "UNSPONSORED";
  context.save();
  context.beginPath();
  context.rect(badgeX + 6, badgeY + 6, badgeW - 12, badgeH - 12);
  context.clip();
  if (sponsorLogo) {
    const logoH = 78;
    drawContainImage(
      context,
      sponsorLogo,
      sponsorLogo.naturalWidth,
      sponsorLogo.naturalHeight,
      badgeX + 16,
      badgeY + 14,
      badgeW - 32,
      logoH,
    );
    const nameSize = fitText(context, sponsorName, badgeW - 48, 28, DISPLAY, 800, 16);
    context.fillStyle = INK;
    context.textAlign = "center";
    context.font = `800 ${nameSize}px ${DISPLAY}`;
    context.fillText(ellipsize(context, sponsorName, badgeW - 48), SIZE / 2, badgeY + logoH + 38);
    context.textAlign = "left";
  } else {
    const label = sponsorName;
    const size = fitText(context, label, badgeW - 48, 52, DISPLAY, 800, 22);
    context.fillStyle = INK;
    context.textAlign = "center";
    context.font = `800 ${size}px ${DISPLAY}`;
    context.fillText(ellipsize(context, label, badgeW - 48), SIZE / 2, badgeY + badgeH / 2);
    context.textAlign = "left";
  }
  context.restore();

  // Name banner: white strip for contrast on green gradient.
  const bannerY = py + ph + 26;
  context.fillStyle = PAPER;
  context.fillRect(px, bannerY, pw, 96);
  context.strokeStyle = INK;
  context.lineWidth = 4;
  context.strokeRect(px, bannerY, pw, 96);
  const name = data.displayName.toUpperCase();
  const nameSize = fitText(context, name, pw - 72, 64, DISPLAY, 800, 26);
  context.fillStyle = INK;
  context.textAlign = "center";
  context.font = `800 ${nameSize}px ${DISPLAY}`;
  context.fillText(ellipsize(context, name, pw - 72), SIZE / 2, bannerY + 50);

  // Headline word: solid ink.
  const headline = sponsored ? "SPONSORED" : "LISTED";
  const headlineY = bannerY + 96 + 92;
  const headlineSize = fitText(context, headline, pw - 40, 168, DISPLAY, 800, 60);
  context.font = `800 ${headlineSize}px ${DISPLAY}`;
  context.fillStyle = INK;
  context.fillText(headline, SIZE / 2, headlineY);

  // Footer strip: handle, value, domain.
  const footY = SIZE - pad - 52;
  context.font = `700 26px ${MONO}`;
  context.fillStyle = "rgba(5,6,10,0.65)";
  context.textAlign = "left";
  context.fillText(ellipsize(context, `@${data.handle ?? data.username}`, 420), px, footY);
  context.textAlign = "center";
  context.fillStyle = INK;
  context.font = `800 34px ${DISPLAY}`;
  const footAmount = money(
    sponsored ? data.currentValueCents ?? data.startingPriceCents : data.startingPriceCents,
  );
  context.fillText(sponsored ? footAmount : `OPENING ${footAmount}`, SIZE / 2, footY);
  context.textAlign = "right";
  context.fillStyle = "rgba(5,6,10,0.45)";
  context.font = `700 26px ${MONO}`;
  context.fillText("socialbid.co", px + pw, footY);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";

  // Global rank pill — drawn dead last so nothing can cover it.
  const rankText = data.globalRank ? `#${data.globalRank}` : "—";
  const rankLabel = "MOST VALUABLE";
  context.font = `800 52px ${DISPLAY}`;
  const rankNumWidth = context.measureText(rankText).width;
  context.font = `700 18px ${MONO}`;
  const rankLabelWidth = context.measureText(rankLabel).width;
  const pillW = Math.max(rankNumWidth, rankLabelWidth) + 44;
  const pillH = 86;
  const pillX = px + pw - pillW - 20;
  const pillY = py + 20;
  context.fillStyle = PAPER;
  context.fillRect(pillX, pillY, pillW, pillH);
  context.strokeStyle = INK;
  context.lineWidth = 4;
  context.strokeRect(pillX, pillY, pillW, pillH);
  context.fillStyle = INK;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = `800 52px ${DISPLAY}`;
  context.fillText(rankText, pillX + pillW / 2, pillY + pillH / 2 - 10);
  context.font = `700 18px ${MONO}`;
  context.fillText(rankLabel, pillX + pillW / 2, pillY + pillH / 2 + 28);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))),
      "image/png",
    );
  });
}

export function CreatorShareCard({
  data,
  compact = false,
}: {
  data: ShareCardData;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copySupported, setCopySupported] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setCopySupported(typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write));
    setReady(false);
    if (canvasRef.current) void drawCard(canvasRef.current, data).then(() => setReady(true));
  }, [data]);

  const download = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await canvasBlob(canvas);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = shareCardFilename(data.username);
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Image downloaded.");
  }, [data.username]);

  const copyImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ClipboardItem === "undefined") return;
    try {
      const blob = await canvasBlob(canvas);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNotice("Image copied.");
    } catch {
      setNotice("Your browser blocked image copying. Download it instead.");
    }
  }, []);

  const copyLink = useCallback(async () => {
    await navigator.clipboard.writeText(shareCardProfileUrl(data.username));
    setNotice("Profile link copied.");
  }, [data.username]);

  const xUrl = `https://x.com/intent/post?text=${encodeURIComponent(shareCardPostText(data))}&url=${encodeURIComponent(shareCardProfileUrl(data.username))}`;

  return (
    <div className={compact ? "space-y-4" : "panel mt-4 p-4 sm:p-6"}>
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        aria-label={`Social Bid share card for ${data.displayName}`}
        className="aspect-square h-auto w-full border-2 border-border bg-card"
      />
      <div className="mt-4 flex flex-wrap gap-2">
        {copySupported ? (
          <Button type="button" variant="outline" disabled={!ready} onClick={copyImage}>
            <Clipboard /> Copy image
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={!ready} onClick={download}>
          <Download /> Download image
        </Button>
        {compact ? (
          <Button type="button" variant="outline" onClick={copyLink}>
            <LinkIcon /> Copy profile link
          </Button>
        ) : null}
        <Button asChild>
          <a href={xUrl} target="_blank" rel="noreferrer">
            <ExternalLink /> {compact ? "Open on X" : "Share on X"}
          </a>
        </Button>
      </div>
      {notice ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
          <Check className="size-4" /> {notice}
        </p>
      ) : null}
    </div>
  );
}
