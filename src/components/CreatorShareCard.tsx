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
const INK = "#11110f";
const PAPER = "#faf9f5";
const BLUE = "#206dcb";
const MUTED = "#aaa9a3";
const SKY = "#42b5ff";

function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxSize: number,
) {
  let size = maxSize;
  while (size > 26) {
    context.font = `800 ${size}px Inter, Arial, sans-serif`;
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

function drawOpenMarketMark(context: CanvasRenderingContext2D, x: number, y: number, size: number) {
  const gradient = context.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, BLUE);
  gradient.addColorStop(1, SKY);
  context.fillStyle = gradient;
  context.fillRect(x, y, size, size);
  context.strokeStyle = PAPER;
  context.lineWidth = 8;
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size * 0.27, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(x + size / 2, y + size / 2, size * 0.08, 0, Math.PI * 2);
  context.fillStyle = PAPER;
  context.fill();
}

function drawAvatarFallback(context: CanvasRenderingContext2D, data: ShareCardData) {
  context.fillStyle = BLUE;
  context.fillRect(72, 286, 590, 590);
  context.fillStyle = PAPER;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "800 250px Inter, Arial, sans-serif";
  context.fillText(data.displayName.trim().slice(0, 1).toUpperCase() || "S", 367, 581);
  context.textAlign = "left";
  context.textBaseline = "alphabetic";
}

async function drawCard(canvas: HTMLCanvasElement, data: ShareCardData) {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, SIZE, SIZE);
  context.fillStyle = INK;
  context.fillRect(0, 0, SIZE, SIZE);
  const sponsored = shareCardState(data) === "sponsored";

  const avatar = await loadAvatar(data.avatarUrl);
  if (avatar) {
    context.save();
    context.filter = "saturate(0.88) contrast(1.08)";
    drawCoverImage(context, avatar, 0, 0, SIZE, 870);
    context.restore();
  } else {
    const gradient = context.createLinearGradient(0, 0, SIZE, 870);
    gradient.addColorStop(0, BLUE);
    gradient.addColorStop(1, INK);
    context.fillStyle = gradient;
    context.fillRect(0, 0, SIZE, 870);
    context.save();
    context.translate(230, 145);
    drawAvatarFallback(context, data);
    context.restore();
  }

  const portraitShade = context.createLinearGradient(0, 250, 0, 870);
  portraitShade.addColorStop(0, "rgba(8,9,11,0)");
  portraitShade.addColorStop(0.56, "rgba(8,9,11,0.18)");
  portraitShade.addColorStop(1, "rgba(8,9,11,0.94)");
  context.fillStyle = portraitShade;
  context.fillRect(0, 0, SIZE, 870);

  const blueGlow = context.createLinearGradient(0, 0, SIZE, 0);
  blueGlow.addColorStop(0, BLUE);
  blueGlow.addColorStop(0.55, SKY);
  blueGlow.addColorStop(1, BLUE);
  context.fillStyle = blueGlow;
  context.fillRect(0, 0, SIZE, 14);
  context.fillRect(0, 856, SIZE, 14);

  context.fillStyle = PAPER;
  context.fillRect(54, 52, 302, 68);
  context.fillStyle = INK;
  context.font = "800 38px Arial Black, Inter, sans-serif";
  context.fillText("SOCIAL BID", 76, 99);
  context.textAlign = "right";
  context.fillStyle = PAPER;
  context.font = "700 24px 'Courier New', monospace";
  context.fillText(data.globalRank ? `GLOBAL RANK #${data.globalRank}` : "OPEN MARKET", 1146, 93);
  context.textAlign = "left";

  const handle = `@${data.handle ?? data.username}`;
  context.fillStyle = SKY;
  context.font = `700 ${fitText(context, handle, 980, 34)}px 'Courier New', monospace`;
  context.fillText(ellipsize(context, handle, 980), 58, 622);
  context.fillStyle = PAPER;
  const nameSize = fitText(context, data.displayName.toUpperCase(), 1084, 82);
  context.font = `800 ${nameSize}px Arial Black, Inter, sans-serif`;
  context.fillText(ellipsize(context, data.displayName.toUpperCase(), 1084), 54, 714);
  context.font = "800 76px Arial Black, Inter, sans-serif";
  context.fillText(sponsored ? "SPONSORED" : "NOW LISTED", 54, 808);

  context.fillStyle = INK;
  context.fillRect(0, 870, SIZE, 330);
  context.fillStyle = PAPER;
  context.font = "700 22px 'Courier New', monospace";
  context.fillText(sponsored ? "CURRENT VALUE" : "OPENING BID", 54, 930);
  context.font = "800 76px Arial Black, Inter, sans-serif";
  context.fillText(money(data.currentValueCents ?? data.startingPriceCents), 54, 1010);

  const sponsorLogo = sponsored ? await loadSponsorLogo(data.sponsorLogoUrl) : null;
  const logoX = 812;
  const logoY = 902;
  const logoSize = 150;
  context.save();
  context.beginPath();
  context.rect(logoX, logoY, logoSize, logoSize);
  context.clip();
  if (sponsorLogo) {
    context.fillStyle = PAPER;
    context.fillRect(logoX, logoY, logoSize, logoSize);
    drawCoverImage(context, sponsorLogo, logoX, logoY, logoSize, logoSize);
  } else if (sponsored) {
    const gradient = context.createLinearGradient(logoX, logoY, logoX + logoSize, logoY + logoSize);
    gradient.addColorStop(0, BLUE);
    gradient.addColorStop(1, SKY);
    context.fillStyle = gradient;
    context.fillRect(logoX, logoY, logoSize, logoSize);
    context.fillStyle = PAPER;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "800 68px Arial Black, Inter, sans-serif";
    context.fillText(
      data.sponsorName?.trim().slice(0, 1).toUpperCase() || "S",
      logoX + 75,
      logoY + 78,
    );
  } else {
    drawOpenMarketMark(context, logoX, logoY, logoSize);
  }
  context.restore();
  context.strokeStyle = PAPER;
  context.lineWidth = 4;
  context.strokeRect(logoX, logoY, logoSize, logoSize);

  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  context.fillStyle = MUTED;
  context.font = "700 20px 'Courier New', monospace";
  context.fillText(sponsored ? "SPONSORED BY" : "SPONSOR STATUS", 1146, 930);
  context.fillStyle = PAPER;
  const sponsorLabel = sponsored ? (data.sponsorName ?? "CURRENT SPONSOR") : "UNSPONSORED";
  const sponsorSize = fitText(context, sponsorLabel.toUpperCase(), 350, 42);
  context.font = `800 ${sponsorSize}px Arial Black, Inter, sans-serif`;
  context.fillText(ellipsize(context, sponsorLabel.toUpperCase(), 350), 1146, 1100);
  context.textAlign = "left";

  context.fillStyle = blueGlow;
  context.fillRect(54, 1160, 1092, 8);
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
