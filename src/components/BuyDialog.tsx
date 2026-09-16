import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { startCheckout } from "@/lib/checkout.functions";
import { uploadSponsorImage } from "@/lib/sponsor-image.functions";
import { trackEvent } from "@/lib/listing.functions";
import { money } from "@/lib/format";
import { safeDestination } from "@/lib/validate";
import type { ListingView } from "@/lib/listing.functions";
import {
  MESSAGE_MAX_CHARS,
  SPONSOR_PREFIX,
  buildPlacementText,
  messageCharLimit,
  validatePlacement,
} from "@/lib/placement";

export function BuyDialog({
  view,
  open,
  onClose,
}: {
  view: ListingView;
  open: boolean;
  onClose: () => void;
}) {
  const checkout = useServerFn(startCheckout);
  const uploadImage = useServerFn(uploadSponsorImage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const price = view.requiredPriceCents;
  const minimumBidDollars = Math.ceil(price / 100);
  const [bidDollars, setBidDollars] = useState(() => String(minimumBidDollars));

  useEffect(() => {
    if (open) setBidDollars(String(minimumBidDollars));
  }, [open, minimumBidDollars]);

  if (!open) return null;
  const retainedChars = view.retainedBioChars ?? 0;
  const limit = messageCharLimit(retainedChars, link);
  const preview = buildPlacementText(
    message.trim() || "Your message",
    link.trim() || "https://yourlink.com",
  );
  const overLimit = message.trim().length > limit;
  const enteredBidDollars = /^\d+$/.test(bidDollars) ? Number(bidDollars) : Number.NaN;
  const bidIsValid =
    Number.isSafeInteger(enteredBidDollars) && enteredBidDollars >= minimumBidDollars;
  const bidCents = bidIsValid ? enteredBidDollars * 100 : price;

  function chooseImage(file: File | null) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      setError("Use a PNG, JPG, or WebP image.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Your image must be 2 MB or smaller.");
      return;
    }
    setError(null);
    setImage(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  async function uploadSelectedImage() {
    if (!image) return null;
    const source = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("read_failed"));
      reader.readAsDataURL(image);
    });
    const result = await uploadImage({
      data: { data: source.replace(/^data:[^;]+;base64,/, ""), type: image.type },
    });
    if ("error" in result) throw new Error(result.error);
    return result.url;
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const msg = message.trim();
    if (!bidIsValid) {
      setError(`Enter a whole-dollar bid of at least ${money(price)}.`);
      setBusy(false);
      return;
    }
    const destination = safeDestination(link);
    if (!destination) {
      setError("Enter a valid public domain, such as yourstartup.com.");
      setBusy(false);
      return;
    }
    const check = validatePlacement({ message: msg, url: destination, retainedChars });
    if (!check.ok) {
      setError(check.error);
      setBusy(false);
      return;
    }
    try {
      const logoUrl = await uploadSelectedImage();
      const res = await checkout({
        data: {
          username: view.creator.username,
          companyName: String(f.get("company") ?? ""),
          bioMessage: msg,
          destinationUrl: destination,
          email: String(f.get("email") ?? ""),
          xHandle: String(f.get("xhandle") ?? "") || null,
          logoUrl,
          bidCents,
          agreed,
        },
      });
      if ("url" in res && res.url) {
        window.location.href = res.url;
        return;
      }
      setError(("error" in res && res.error) || "Something went wrong.");
    } catch {
      setError("Something went wrong. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-foreground/60 p-4 sm:p-8">
      <div className="panel mx-auto w-full max-w-lg">
        <div className="flex items-center justify-between border-b-2 border-border px-5 py-4">
          <span className="label-xs !text-foreground">
            {view.owner ? "Place bid" : "Sponsor this creator"}
          </span>
          <button
            onClick={onClose}
            className="text-2xl leading-none font-bold text-foreground hover:opacity-70"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 border-b-2 border-border">
          <div className="border-r-2 border-border px-5 py-4">
            <div className="label-xs">Current sponsor</div>
            <div className="font-bold text-foreground">
              {view.owner?.company_name ?? "Available"}
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="label-xs">{view.owner ? "Current bid" : "Starting price"}</div>
            <div className="font-bold text-foreground">
              {view.owner ? money(view.owner.amount_cents) : "—"}
            </div>
          </div>
        </div>

        <div className="border-b-2 border-border px-5 py-4 text-sm text-foreground">
          <p>
            You're sponsoring this creator on SocialBid. Your message and link stay in the
            <b> sponsorship spot</b> until somebody pays more.
          </p>
          <p className="mt-2 text-foreground/75">
            Your placement is always published with a “{SPONSOR_PREFIX}” label so it's clear to
            everyone that it's paid advertising. Your message must not imply that you own, run or
            are employed by the creator, and must not impersonate the creator or anyone else.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4 px-5 py-5">
          <div>
            <label className="label-xs" htmlFor="biomessage">
              Your message *
            </label>
            <input
              id="biomessage"
              name="biomessage"
              required
              minLength={3}
              maxLength={MESSAGE_MAX_CHARS}
              value={message}
              onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX_CHARS))}
              placeholder="Sponsored by YourStartup"
              className="field mt-1"
            />
            <div className="mt-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {limit < MESSAGE_MAX_CHARS
                  ? `${limit} characters available.`
                  : "Your placement stays live until someone pays more."}
              </span>
              <span
                className={overLimit ? "font-semibold text-destructive" : "text-muted-foreground"}
              >
                {message.trim().length} / {limit}
              </span>
            </div>
          </div>
          <div>
            <label className="label-xs" htmlFor="destination">
              Your link *
            </label>
            <input
              id="destination"
              name="destination"
              required
              type="text"
              inputMode="url"
              autoCapitalize="none"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="yourstartup.com"
              className="field mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Your link is shown with your message on the creator's SocialBid profile. We'll add
              https:// automatically.
            </p>
          </div>

          <div className="border-2 border-border bg-muted px-4 py-3">
            <div className="label-xs">Exactly how your placement appears</div>
            <p className="mt-1 text-sm font-medium break-words text-foreground">{preview}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              We add the “{SPONSOR_PREFIX}” label automatically — it can't be removed, so your
              placement is always clearly disclosed as paid advertising.
            </p>
          </div>

          <div>
            <label className="label-xs" htmlFor="company">
              Startup / Brand name *
            </label>
            <input id="company" name="company" required maxLength={80} className="field mt-1" />
          </div>
          <div>
            <label className="label-xs" htmlFor="email">
              Email *
            </label>
            <input id="email" name="email" type="email" required className="field mt-1" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-xs" htmlFor="xhandle">
                X handle
              </label>
              <input id="xhandle" name="xhandle" placeholder="@you" className="field mt-1" />
            </div>
            <div>
              <label className="label-xs" htmlFor="sponsor-image">
                Sponsor image
              </label>
              <div className="mt-1 flex items-center gap-3">
                {imagePreview ? (
                  <img
                    src={imagePreview}
                    alt="Sponsor image preview"
                    className="size-11 shrink-0 border-2 border-border object-cover"
                  />
                ) : (
                  <div className="size-11 shrink-0 border-2 border-dashed border-border bg-muted" />
                )}
                <input
                  id="sponsor-image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => chooseImage(event.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:border-0 file:bg-foreground file:px-3 file:py-2 file:font-bold file:text-background"
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Optional. PNG, JPG or WebP up to 2 MB. It appears as a square icon.
              </p>
            </div>
          </div>

          <div className="border-2 border-border bg-accent px-4 py-3">
            <div className="label-xs !text-accent-foreground/70">Your bid</div>
            <div className="mt-1 flex items-center gap-2 text-accent-foreground">
              <span className="text-4xl font-extrabold tracking-tight">$</span>
              <input
                id="bid"
                name="bid"
                required
                inputMode="numeric"
                pattern="[0-9]*"
                value={bidDollars}
                onChange={(event) => setBidDollars(event.target.value)}
                aria-describedby="bid-minimum"
                className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-1 text-4xl font-extrabold tracking-tight text-foreground outline-none focus:ring-2 focus:ring-foreground"
              />
            </div>
            <p id="bid-minimum" className="mt-2 text-xs text-accent-foreground/75">
              Minimum bid: {money(price)}
            </p>
          </div>

          <div className="border-2 border-border px-4 py-3 text-sm text-foreground">
            <p className="font-semibold">
              Your sponsorship spot stays live until somebody pays more.
            </p>
            <p className="mt-1 text-muted-foreground">
              Your sponsored message goes live on this creator's SocialBid profile immediately after
              payment.
            </p>
          </div>

          <label className="flex items-start gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-1 size-4 accent-foreground"
              required
            />
            <span>
              I agree to the{" "}
              <a href="/terms" className="font-semibold underline">
                Terms
              </a>{" "}
              , confirm my placement is honest advertising that doesn't impersonate the creator or
              anyone else, and understand messages and destinations are subject to moderation.
            </span>
          </label>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <button
            type="submit"
            disabled={
              busy || !agreed || !bidIsValid || message.trim().length < 3 || overLimit || limit <= 0
            }
            onClick={() => {
              void trackEvent({ data: { name: "buy_clicked", listingId: view.listing.id } });
            }}
            className="btn-ink btn-ink-hover w-full text-base disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy
              ? "Opening checkout…"
              : `${view.owner ? `Place bid${view.globalRank === 1 ? " for #1" : ""}` : "Sponsor this creator"} — ${money(bidCents)}`}
          </button>
        </form>
      </div>
    </div>
  );
}
