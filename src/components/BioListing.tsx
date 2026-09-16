import { useEffect, useState } from "react";
import { money, duration, hostOf } from "@/lib/format";
import type { ListingView } from "@/lib/listing.functions";
import { trackEvent } from "@/lib/listing.functions";
import { BuyDialog } from "./BuyDialog";
import { XIcon } from "./XIcon";
import { CreatorAvatar } from "./CreatorAvatar";
import { Share2, Trophy } from "lucide-react";

function ProfileCard({ view }: { view: ListingView }) {
  const c = view.creator;
  return (
    <div className="panel p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <CreatorAvatar creator={c} sizeClass="size-14" fallbackTextClass="text-xl" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg leading-tight font-extrabold">{c.display_name}</span>
            {c.x_account_verified ? (
              <span className="inline-flex items-center gap-1 border-2 border-border bg-accent px-2 py-0.5 font-mono text-[0.65rem] font-bold text-accent-foreground">
                ✓ X connected
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <XIcon className="size-3.5" />
              <span>X · @{c.x_username ?? c.social_handle}</span>
            </span>
            {c.x_follower_count ? (
              <span>· {c.x_follower_count.toLocaleString()} followers</span>
            ) : null}
          </div>
          {c.x_username || c.social_profile_url ? (
            <a
              href={c.x_profile_url ?? c.social_profile_url ?? `https://x.com/${c.x_username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 text-sm font-medium underline"
            >
              <XIcon className="size-3.5" /> View on X
            </a>
          ) : null}
          <p className="mt-3 text-sm">{c.bio}</p>
          <div className="mt-4">
            <div className="inline-block border-2 border-border bg-accent px-3 py-1.5 font-mono text-sm font-bold">
              socialbid.co/{c.username}
            </div>
            <div className="label-xs mt-2">↑ This creator's SocialBid profile</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-border px-5 py-4 not-last:border-b-2 sm:not-last:border-r-2 sm:not-last:border-b-0">
      <div className="label-xs">{label}</div>
      <div className="mt-1 truncate text-lg font-bold">{value}</div>
    </div>
  );
}

export function BioListing({ view, heading }: { view: ListingView; heading: boolean }) {
  const [open, setOpen] = useState(false);
  const owner = view.owner;
  const price = view.requiredPriceCents;

  useEffect(() => {
    void trackEvent({
      data: { name: heading ? "homepage_view" : "listing_view", listingId: view.listing.id },
    });
  }, [heading, view.listing.id]);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      {heading ? (
        <h1 className="text-[clamp(2.75rem,11vw,6.5rem)] leading-[0.85] font-semibold tracking-[-0.05em]">
          Add your profile
        </h1>
      ) : (
        <h1 className="text-[clamp(2rem,7vw,3.5rem)] leading-[0.9] font-semibold tracking-[-0.05em]">
          Sponsor @{view.creator.x_username ?? view.creator.social_handle}
        </h1>
      )}

      <p className="mt-5 text-2xl font-bold sm:text-3xl">Sponsor this creator on SocialBid.</p>
      <p className="mt-1 text-base text-muted-foreground sm:text-lg">
        Hold the spot until you're outbid and unlock a direct connection.
      </p>

      <div className="mt-8 grid border-2 border-border bg-foreground text-background sm:grid-cols-3">
        <div className="px-5 py-4 sm:border-r sm:border-background/25">
          <div className="font-mono text-[0.65rem] font-bold text-background/60">Global rank</div>
          <div className="mt-1 flex items-center gap-2 text-2xl font-extrabold">
            {view.globalRank === 1 ? <Trophy className="size-5 text-accent" /> : null}
            {view.globalRank ? `#${view.globalRank} most valuable` : "Unranked"}
          </div>
        </div>
        <div className="border-t border-background/25 px-5 py-4 sm:border-t-0 sm:border-r">
          <div className="font-mono text-[0.65rem] font-bold text-background/60">
            Sponsorship value
          </div>
          <div className="mt-1 text-2xl font-extrabold">
            {view.bioValueCents === null || view.bioValueCents === undefined
              ? "—"
              : money(view.bioValueCents)}
          </div>
        </div>
        <div className="border-t border-background/25 px-5 py-4 sm:border-t-0">
          <div className="font-mono text-[0.65rem] font-bold text-background/60">Sponsored by</div>
          <div className="mt-1 truncate text-2xl font-extrabold">
            {owner?.company_name ?? "Unsponsored"}
          </div>
        </div>
      </div>

      {view.globalRank && view.bioValueCents !== null && view.bioValueCents !== undefined ? (
        <a
          href={`https://x.com/intent/post?text=${encodeURIComponent(
            `@${view.creator.x_username ?? view.creator.social_handle}'s sponsorship on SocialBid is now worth ${money(view.bioValueCents)} — currently #${view.globalRank}.`,
          )}&url=${encodeURIComponent(`https://socialbid.co/u/${view.creator.username}`)}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 text-sm font-bold underline"
        >
          <Share2 className="size-4" /> Share this rank
        </a>
      ) : null}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <ProfileCard view={view} />

        <div className="panel flex flex-col justify-between">
          <div className="border-b-2 border-border px-5 py-4">
            <div className="label-xs">Sponsored on SocialBid</div>
            <div className="mt-1 flex items-center gap-3">
              {owner?.logo_url && (
                <img
                  src={owner.logo_url}
                  alt={`${owner.company_name} logo`}
                  className="size-8 border-2 border-border object-contain"
                  loading="lazy"
                />
              )}
              <span className="text-2xl font-extrabold">
                {owner ? owner.company_name : "Available"}
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Sponsorship appears on SocialBid only.
            </p>
          </div>

          <div className="px-5 py-6">
            <div className="label-xs">{owner ? "Sponsorship value" : "Starting price"}</div>
            <div className="text-[clamp(3rem,14vw,5.5rem)] leading-[0.85] font-semibold tracking-[-0.05em]">
              {money(owner ? owner.amount_cents : view.listing.starting_price_cents)}
            </div>
          </div>

          <div className="grid grid-cols-2 border-t-2 border-border">
            <div className="border-r-2 border-border px-5 py-4">
              <div className="label-xs">Destination</div>
              <div className="truncate font-bold">
                {owner ? hostOf(owner.destination_url) : "—"}
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="label-xs">Clicks</div>
              <div className="font-bold">{(owner?.click_count ?? 0).toLocaleString()}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        {view.canBuy ? (
          <>
            <button
              onClick={() => setOpen(true)}
              className="btn-ink btn-ink-hover w-full py-6 text-[clamp(1.25rem,4.5vw,2rem)] font-semibold tracking-tight"
            >
              {owner
                ? `Place bid${view.globalRank === 1 ? " for #1" : ""}`
                : "Sponsor this creator"}{" "}
              — {money(price)}
            </button>
            <div className="panel mt-6 px-5 py-5 text-sm">
              <p>
                <span className="font-bold">What you get:</span> your sponsored message and tracked
                link in this creator's sponsorship spot on SocialBid, plus a direct Inbox connection
                that stays open if you're outbid.
              </p>
            </div>
          </>
        ) : (
          <div className="panel px-5 py-6 text-center">
            <p className="font-bold">This profile isn't accepting sponsors right now.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!view.creator.x_account_verified
                ? "This creator has disconnected X. Their ranking entry remains permanent."
                : "This profile is paused."}
            </p>
          </div>
        )}
      </div>

      <section className="mt-20">
        <h2 className="label-xs">Previous sponsors</h2>
        {view.history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No previous sponsors yet. {owner ? "" : "Be the first."}
          </p>
        ) : (
          <div className="panel mt-3 divide-y-2 divide-border">
            <div className="label-xs grid grid-cols-4 gap-2 px-4 py-2">
              <span>Sponsor</span>
              <span>Paid</span>
              <span>Sponsored for</span>
              <span className="text-right">Clicks</span>
            </div>
            {view.history.map((o) => (
              <div key={o.id} className="grid grid-cols-4 gap-2 px-4 py-3 text-sm">
                <span className="truncate font-bold">{o.company_name}</span>
                <span>{money(o.amount_cents)}</span>
                <span>{duration(o.started_at, o.ended_at)}</span>
                <span className="text-right">{o.click_count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-20 grid gap-6 sm:grid-cols-3">
        {[
          ["1. Sponsor", "Pay the current price for the creator's sponsor spot."],
          [
            "2. Get featured",
            "Your message + link appears on the creator's SocialBid profile, and your direct connection unlocks.",
          ],
          [
            "3. Get outbid",
            "The new sponsor takes the public spot, but your Inbox connection stays open.",
          ],
        ].map(([t, d]) => (
          <div key={t} className="panel px-5 py-6">
            <div className="text-lg font-extrabold">{t}</div>
            <p className="mt-2 text-sm text-muted-foreground">{d}</p>
          </div>
        ))}
      </section>
      <p className="mt-6 font-mono text-sm">
        No deadline. No expiry. The top sponsor keeps the spot.
      </p>

      <BuyDialog view={view} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export { Stat };
