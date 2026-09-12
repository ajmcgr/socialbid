import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, Download, ExternalLink, Link as LinkIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import {
  avatarProxyUrl,
  shareCardFilename,
  shareCardPostText,
  shareCardProfileUrl,
  shareCardState,
  type ShareCardData,
} from "@/lib/share-card";

const SIZE = 1200;
const INK = "#11110f";
const PAPER = "#faf9f5";
const BLUE = "#206dcb";
const MUTED = "#aaa9a3";

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxSize: number) {
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
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
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
  context.fillStyle = PAPER;
  context.fillRect(0, 0, SIZE, SIZE);
  context.fillStyle = INK;
  context.fillRect(0, 0, SIZE, 222);
  context.fillRect(0, 920, SIZE, 280);
  context.fillStyle = BLUE;
  context.fillRect(0, 214, SIZE, 8);

  context.fillStyle = PAPER;
  context.font = "800 86px Inter, Arial, sans-serif";
  context.fillText("SOCIAL BID", 72, 112);
  context.font = "700 27px 'Courier New', monospace";
  const sponsored = shareCardState(data) === "sponsored";
  context.fillText(sponsored ? "SPONSORSHIP ANNOUNCEMENT" : "MARKET ENTRY", 76, 171);
  context.textAlign = "right";
  context.fillStyle = MUTED;
  context.fillText(data.globalRank ? `GLOBAL RANK #${data.globalRank}` : "OPEN MARKET", 1128, 171);
  context.textAlign = "left";

  let avatarDrawn = false;
  const proxy = avatarProxyUrl(data.avatarUrl);
  if (proxy) {
    try {
      const image = await loadImage(proxy);
      const scale = Math.max(590 / image.naturalWidth, 590 / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.save();
      context.beginPath();
      context.rect(72, 286, 590, 590);
      context.clip();
      context.drawImage(image, 72 + (590 - width) / 2, 286 + (590 - height) / 2, width, height);
      context.restore();
      avatarDrawn = true;
    } catch {
      avatarDrawn = false;
    }
  }
  if (!avatarDrawn) drawAvatarFallback(context, data);
  context.strokeStyle = INK;
  context.lineWidth = 10;
  context.strokeRect(72, 286, 590, 590);

  const textX = 714;
  const textWidth = 414;
  context.fillStyle = BLUE;
  const handle = `@${data.handle ?? data.username}`;
  context.font = `700 ${fitText(context, handle, textWidth, 34)}px 'Courier New', monospace`;
  context.fillText(ellipsize(context, handle, textWidth), textX, 342);
  context.fillStyle = INK;
  const nameSize = fitText(context, data.displayName.toUpperCase(), textWidth, 68);
  context.font = `800 ${nameSize}px Inter, Arial, sans-serif`;
  const name = ellipsize(context, data.displayName.toUpperCase(), textWidth);
  context.fillText(name, textX, 428);
  context.fillRect(textX, 468, textWidth, 7);

  context.font = "800 60px Inter, Arial, sans-serif";
  context.fillText(sponsored ? "SPONSORED" : "ENTERED", textX, 584);
  context.fillText(sponsored ? "ON SOCIAL BID" : "THE MARKET", textX, 654);
  context.fillStyle = BLUE;
  context.fillRect(textX, 707, 86, 12);
  context.fillStyle = INK;
  context.font = "700 25px 'Courier New', monospace";
  context.fillText("SOCIALBID.CO", textX, 784);
  context.fillText(`/U/${data.username.toUpperCase()}`, textX, 824);

  context.fillStyle = PAPER;
  context.font = "700 26px 'Courier New', monospace";
  context.fillText(sponsored ? "CURRENT VALUE" : "OPENING BID", 72, 984);
  context.font = "800 88px Inter, Arial, sans-serif";
  context.fillText(money(data.currentValueCents ?? data.startingPriceCents), 72, 1076);
  if (sponsored && data.sponsorName) {
    context.textAlign = "right";
    context.font = "700 25px 'Courier New', monospace";
    context.fillStyle = MUTED;
    context.fillText("SPONSORED BY", 1128, 984);
    context.fillStyle = PAPER;
    const sponsorSize = fitText(context, data.sponsorName.toUpperCase(), 480, 48);
    context.font = `800 ${sponsorSize}px Inter, Arial, sans-serif`;
    context.fillText(ellipsize(context, data.sponsorName.toUpperCase(), 480), 1128, 1051);
    context.textAlign = "left";
  }
  context.fillStyle = BLUE;
  context.fillRect(72, 1137, 1056, 10);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG export failed"))), "image/png");
  });
}

export function CreatorShareCard({ data, compact = false }: { data: ShareCardData; compact?: boolean }) {
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