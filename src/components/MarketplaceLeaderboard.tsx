import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUpRight, Share2 } from "lucide-react";
import { money } from "@/lib/format";
import { getSiteTraffic } from "@/lib/analytics.functions";
import type {
  MarketplaceActivity,
  MarketplaceRow,
  MarketplaceSnapshot,
  MarketplaceSort,
} from "@/lib/marketplace.server";
import { getSupabase } from "@/integrations/supabase/browser";

import { BuyDialog } from "./BuyDialog";
import { XIcon } from "./XIcon";
import { CreatorAvatar } from "./CreatorAvatar";

const sorts: Array<{ value: MarketplaceSort; label: string }> = [
  { value: "most-valuable", label: "Most valuable" },
  { value: "trending", label: "Trending" },
  { value: "new", label: "New" },
  { value: "affordable", label: "Affordable" },
];

const RANKINGS_PAGE_SIZE = 50;

function rankingsPageHref(sort: MarketplaceSort, page: number) {
  const params = new URLSearchParams();
  if (sort !== "most-valuable") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function RankingsPagination({
  sort,
  page,
  totalPages,
}: {
  sort: MarketplaceSort;
  page: number;
  totalPages: number;
}) {
  if (totalPages < 2) return null;

  return (
    <nav className="mt-5 flex items-center justify-center gap-3" aria-label="Rankings pages">
      {page > 1 ? (
        <a href={rankingsPageHref(sort, page - 1)} className="btn-outline-ink px-4 py-2 text-sm">
          Previous
        </a>
      ) : (
        <span className="btn-outline-ink cursor-not-allowed px-4 py-2 text-sm opacity-40">
          Previous
        </span>
      )}
      <span className="font-mono text-xs font-bold">
        Page {page} of {totalPages}
      </span>
      {page < totalPages ? (
        <a href={rankingsPageHref(sort, page + 1)} className="btn-outline-ink px-4 py-2 text-sm">
          Next
        </a>
      ) : (
        <span className="btn-outline-ink cursor-not-allowed px-4 py-2 text-sm opacity-40">
          Next
        </span>
      )}
    </nav>
  );
}

function TrafficCounters() {
  const getTraffic = useServerFn(getSiteTraffic);
  const [traffic, setTraffic] = useState<{ pageviews: number; online: number } | null>(null);

  useEffect(() => {
    void getTraffic()
      .then(setTraffic)
      .catch(() => undefined);
  }, [getTraffic]);

  return (
    <a
      href="https://cloud.umami.is/share/3BTUSlr3W6nAGqWJ"
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs font-bold text-primary hover:underline"
    >
      {traffic ? traffic.pageviews.toLocaleString() : "—"} total visitors · {traffic?.online ?? "—"}{" "}
      live ↗
    </a>
  );
}

function handleOf(row: MarketplaceRow) {
  return row.creator.x_username ?? row.creator.social_handle ?? row.creator.username;
}

function CreatorIdentity({ row, large = false }: { row: MarketplaceRow; large?: boolean }) {
  const handle = handleOf(row);
  const creatorUrl = row.creator.x_profile_url ?? row.creator.social_profile_url;
  return (
    <div className="flex min-w-0 items-center gap-3 sm:gap-4">
      <CreatorAvatar
        creator={row.creator}
        sizeClass={large ? "size-16 sm:size-20" : "size-12"}
        fallbackTextClass={large ? "text-2xl" : "text-lg"}
      />
      <div className="min-w-0">
        <Link
          to="/u/$username"
          params={{ username: row.creator.username }}
          className={`${large ? "text-xl sm:text-2xl" : "text-base sm:text-lg"} block truncate font-extrabold hover:underline`}
        >
          {row.creator.display_name}
        </Link>
        <div className="flex items-center gap-1.5 truncate font-mono text-xs text-muted-foreground sm:text-sm">
          <XIcon className="size-3 shrink-0" />
          {creatorUrl ? (
            <a
              href={creatorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate hover:underline"
              aria-label={`Open @${handle} on X`}
            >
              @{handle}
            </a>
          ) : (
            <span>@{handle}</span>
          )}
          {row.creator.x_account_verified ? <span aria-label="X connected">✓</span> : null}
        </div>
        {large && row.creator.x_follower_count ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {row.creator.x_follower_count.toLocaleString()} followers
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SponsorDetails({ row }: { row: MarketplaceRow }) {
  const sponsor = row.owner;
  if (!sponsor) return null;

  return (
    <div className="min-w-0">
      <div className="label-xs">Sponsored by</div>
      <a
        href={`/api/public/outbound?username=${encodeURIComponent(row.creator.username)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-1 flex min-w-0 items-center gap-2 hover:underline"
      >
        {sponsor.logo_url ? (
          <img
            src={sponsor.logo_url}
            alt={`${sponsor.company_name} logo`}
            className="size-8 shrink-0 border-2 border-border object-contain"
            loading="lazy"
          />
        ) : null}
        <span className="truncate font-semibold">{sponsor.company_name}</span>
        <ArrowUpRight className="size-3.5 shrink-0" />
      </a>
      {sponsor.bio_message ? (
        <p className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
          {sponsor.bio_message}
        </p>
      ) : null}
      <div className="mt-1 font-mono text-xs text-muted-foreground">
        {row.sponsorClickCount.toLocaleString()} {row.sponsorClickCount === 1 ? "click" : "clicks"}
      </div>
    </div>
  );
}

function TakeoverButton({ row, prominent = false }: { row: MarketplaceRow; prominent?: boolean }) {
  const [open, setOpen] = useState(false);
  const verb = row.owner ? "Place bid" : "Sponsor";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!row.canBuy}
        className={`${prominent ? "w-full py-4 text-base sm:text-lg" : "px-4 py-2.5 text-sm"} btn-ink btn-ink-hover whitespace-nowrap disabled:opacity-40`}
      >
        {row.canBuy
          ? `${verb}${row.globalRank === 1 ? " #1" : ""} — ${money(row.requiredPriceCents)}`
          : "Unavailable"}
      </button>
      <BuyDialog view={row} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LeaderboardRow({
  row,
  position,
  isMostValuableLeader = false,
}: {
  row: MarketplaceRow;
  position: number;
  isMostValuableLeader?: boolean;
}) {
  const owned = row.bioValueCents !== null && row.owner;
  const displayRank = position + 1;
  return (
    <article
      className={`grid gap-4 border-x-2 border-b-2 border-border p-4 sm:grid-cols-[3rem_minmax(0,1.4fr)_0.75fr_minmax(0,1.15fr)_auto] sm:items-center sm:gap-5 sm:px-5 ${"bg-card"}`}
    >
      <div
        className="font-mono text-2xl font-extrabold"
        aria-label={isMostValuableLeader ? "#1 most valuable" : undefined}
      >
        #{displayRank}
      </div>
      <CreatorIdentity row={row} />
      <div>
        <div className="label-xs">
          {!row.canBuy ? "Sponsorship" : owned ? "Sponsorship value" : "Starting price"}
        </div>
        <div className="mt-0.5 text-xl font-extrabold">
          {!row.canBuy
            ? "Unavailable"
            : money(owned ? row.bioValueCents! : row.listing.starting_price_cents)}
        </div>
        {!owned && row.canBuy ? (
          <div className="mt-0.5 font-mono text-[0.65rem] font-bold">Unsponsored</div>
        ) : null}
      </div>
      {row.owner ? <SponsorDetails row={row} /> : <div aria-hidden="true" />}
      <TakeoverButton row={row} />
    </article>
  );
}

function ActivityLine({ item }: { item: MarketplaceActivity }) {
  // Historical platform-owned sponsorship records used the former product
  // name. Keep the record intact and normalize only this public display.
  const sponsorName = item.companyName === "Buy My Bio" ? "SocialBid" : item.companyName;
  const copy =
    item.type === "listed"
      ? `@${item.handle} entered the market`
      : item.globalRank === 1
        ? `${sponsorName} just took the #1 sponsorship spot`
        : `${sponsorName} is now sponsoring @${item.handle}`;
  return (
    <div className="flex flex-col gap-1 border-b border-border/30 py-3 last:border-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <Link
        to="/u/$username"
        params={{ username: item.username }}
        className="font-mono text-xs font-bold hover:underline"
      >
        {copy}
      </Link>
      <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
        <span className="font-bold">
          {item.amountCents !== null
            ? `${item.type === "listed" ? "From " : ""}${money(item.amountCents)}`
            : ""}
        </span>
        <span className="text-muted-foreground">{timeAgo(item.happenedAt)}</span>
      </div>
    </div>
  );
}

function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function AddYourProfile() {
  const [handle, setHandle] = useState("");
  return (
    <section
      aria-labelledby="add-heading"
      className="mb-8 border-2 border-border bg-card px-4 py-5 sm:px-6 sm:py-6"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 id="add-heading" className="text-xl font-semibold">
            Add your profile. Get sponsored.
          </h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Connect X in seconds. Anyone can sponsor you. You keep 80%.
          </p>
        </div>
        <form
          className="flex w-full max-w-md flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            window.location.href = "/api/public/x-start";
          }}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 border-2 border-border bg-background px-3">
            <span className="font-mono text-sm text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
              placeholder="yourhandle"
              aria-label="Your X handle"
              className="min-w-0 flex-1 bg-transparent py-3 font-mono text-sm outline-none"
            />
          </div>
          <button type="submit" className="btn-ink btn-ink-hover shrink-0 px-5 py-3 text-sm">
            Add my profile
          </button>
        </form>
      </div>
    </section>
  );
}

export function MarketplaceLeaderboard({
  market,
  page,
}: {
  market: MarketplaceSnapshot;
  page: number;
}) {
  const router = useRouter();
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  const lastScrollKey = useRef<string | null>(null);

  useEffect(() => {
    const restartRealtime = () => setRealtimeEpoch((epoch) => epoch + 1);
    window.addEventListener("social-bid-recover", restartRealtime);
    return () => window.removeEventListener("social-bid-recover", restartRealtime);
  }, []);

  // When the page (or tab) changes, scroll back to the top of the rankings
  // section rather than the very top of the site. Skipped on first render.
  useEffect(() => {
    const key = `${market.sort}:${page}`;
    if (lastScrollKey.current === null) {
      lastScrollKey.current = key;
      return;
    }
    if (lastScrollKey.current !== key) {
      lastScrollKey.current = key;
      document
        .getElementById("leaderboard-heading")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [market.sort, page]);

  useEffect(() => {
    const refresh = () => void router.invalidate();
    const interval = window.setInterval(refresh, 30_000);
    const db = getSupabase();
    const channel = db
      ?.channel("public-market")
      .on("postgres_changes", { event: "*", schema: "public", table: "ownerships" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "listings" }, refresh)
      .subscribe();
    return () => {
      window.clearInterval(interval);
      if (db && channel) void db.removeChannel(channel);
    };
  }, [realtimeEpoch, router]);

  const numberOne = market.sort === "most-valuable" ? market.rows[0] : null;
  const isMostValuable = market.sort === "most-valuable";
  const rankedRows = isMostValuable ? [...market.rows, ...market.unowned] : market.rows;
  const totalPages = Math.max(1, Math.ceil(rankedRows.length / RANKINGS_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * RANKINGS_PAGE_SIZE;
  const pageEnd = pageStart + RANKINGS_PAGE_SIZE;
  const visibleRows = rankedRows.slice(pageStart, pageEnd);
  const visibleOwned = isMostValuable
    ? visibleRows.slice(0, Math.max(0, market.rows.length - pageStart))
    : visibleRows;
  const unownedPageStart = Math.max(0, pageStart - market.rows.length);
  const visibleUnowned = isMostValuable
    ? visibleRows.slice(Math.max(0, market.rows.length - pageStart))
    : [];
  const showSeparateUnowned = visibleUnowned.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-5">
      <section className="pb-6 pt-4 sm:pb-8 sm:pt-7">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center">
            <TrafficCounters />
            <h1 className="mt-1 text-[clamp(2.2rem,5vw,3rem)] leading-[0.88] font-extrabold tracking-[-0.055em]">
              How much are you worth on X?
            </h1>
            <p className="mt-3 max-w-2xl text-base font-medium text-muted-foreground sm:text-lg">
              Add your X profile. Anyone compete to sponsor you. You keep 80%.
            </p>
          </div>
        </div>
      </section>

      <AddYourProfile />

      <section aria-labelledby="leaderboard-heading">
        <div className="flex flex-col gap-4 border-2 border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div>
            <h2 id="leaderboard-heading" className="text-lg font-extrabold">
              Rankings
            </h2>
            <p className="text-xs text-muted-foreground">
              Ranked by successful sponsorship payments. No weighting. No boosting.
            </p>
          </div>
          <div className="flex max-w-full gap-1 overflow-x-auto" aria-label="Leaderboard sorting">
            {sorts.map((sort) => {
              const active = market.sort === sort.value;
              const href = rankingsPageHref(sort.value, 1);
              return (
                <a
                  key={sort.value}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 px-3 py-2 font-mono text-[0.65rem] font-bold ${
                    active ? "bg-foreground text-background" : "bg-muted hover:bg-accent"
                  }`}
                >
                  {sort.label}
                </a>
              );
            })}
          </div>
        </div>

        {visibleOwned.length > 0 ? (
          <div>
            {visibleOwned.map((row, index) => (
              <LeaderboardRow
                key={row.listing.id}
                row={row}
                position={pageStart + index}
                isMostValuableLeader={isMostValuable && pageStart + index === 0}
              />
            ))}
          </div>
        ) : rankedRows.length === 0 ? (
          <div className="border-x-2 border-b-2 border-border bg-card px-5 py-10 text-center">
            <p className="text-xl font-extrabold">No profiles have been listed yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              The first successful live payment will create the first real market value and #1 rank.
            </p>
          </div>
        ) : null}
      </section>

      {showSeparateUnowned ? (
        <section className="mt-12" aria-labelledby="unowned-heading">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 id="unowned-heading" className="text-xl font-extrabold">
                Unsponsored profiles
              </h2>
              <p className="text-xs text-muted-foreground">
                Starting prices are not sponsorship value and do not affect the rankings.
              </p>
            </div>
            <Link to="/creator" className="hidden text-sm font-bold underline sm:block">
              Add yours
            </Link>
          </div>
          <div className="border-t-2 border-border">
            {visibleUnowned.map((row, index) => (
              <LeaderboardRow
                key={row.listing.id}
                row={row}
                position={market.rows.length + unownedPageStart + index}
              />
            ))}
          </div>
        </section>
      ) : null}

      <RankingsPagination sort={market.sort} page={currentPage} totalPages={totalPages} />

      <section className="mt-12 grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="border-2 border-border bg-card px-4 sm:px-5">
          <div className="flex items-center justify-between border-b-2 border-border py-4">
            <h2 className="font-mono text-xs font-extrabold">Live activity</h2>
            <span className="size-2 animate-pulse rounded-full bg-primary" />
          </div>
          {market.activity.length ? (
            market.activity.map((item) => <ActivityLine key={item.id} item={item} />)
          ) : (
            <p className="py-8 text-sm text-muted-foreground">No market activity yet.</p>
          )}
        </div>
        <div className="border-2 border-border bg-accent p-5 text-accent-foreground">
          <div className="label-xs !text-accent-foreground/60">The status loop</div>
          <p className="mt-3 text-xl leading-tight font-extrabold">
            Sponsor a creator. Hold the spot until you're outbid. Unlock a direct connection.
          </p>
          <Link
            to="/creator"
            className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold underline"
          >
            Add your profile <ArrowUpRight className="size-4" />
          </Link>
          {numberOne ? (
            <a
              className="mt-4 flex items-center gap-2 text-sm font-bold underline"
              href={`https://x.com/intent/post?text=${encodeURIComponent(
                `@${handleOf(numberOne)} has the #1 creator sponsorship on SocialBid at ${money(numberOne.bioValueCents ?? 0)}.`,
              )}&url=${encodeURIComponent(`https://socialbid.co/u/${numberOne.creator.username}`)}`}
              target="_blank"
              rel="noreferrer"
            >
              <Share2 className="size-4" /> Share #1
            </a>
          ) : null}
        </div>
      </section>

      <section className="mt-4 border-2 border-border bg-muted px-5 py-6 text-center">
        <div className="label-xs text-sm">Total sponsorships since launch</div>
        <div className="mt-1 text-4xl font-extrabold">{money(market.totalSponsorshipsCents)}</div>
      </section>
    </div>
  );
}
