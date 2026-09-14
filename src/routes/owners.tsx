import { createFileRoute, Link } from "@tanstack/react-router";
import { Share2, Trophy } from "lucide-react";
import { getMarketplace } from "@/lib/marketplace.functions";
import { money } from "@/lib/format";

export const Route = createFileRoute("/owners")({
  loader: async () => await getMarketplace({ data: { sort: "most-valuable" } }),
  head: () => ({
    meta: [
      { title: "Top Sponsors — SocialBid" },
      {
        name: "description",
        content: "See the buyers and brands holding the most valuable creator sponsorships.",
      },
    ],
  }),
  component: OwnersPage,
});

function OwnersPage() {
  const market = Route.useLoaderData();
  const numberOne = market.rows[0];
  const groups = new Map<
    string,
    { name: string; totalValueCents: number; bios: typeof market.rows; ownsNumberOne: boolean }
  >();
  for (const row of market.rows) {
    if (!row.owner) continue;
    const key = row.owner.company_name.trim().toLowerCase();
    const group = groups.get(key) ?? {
      name: row.owner.company_name,
      totalValueCents: 0,
      bios: [],
      ownsNumberOne: false,
    };
    group.totalValueCents += row.bioValueCents ?? 0;
    group.bios.push(row);
    group.ownsNumberOne ||= row.globalRank === 1;
    groups.set(key, group);
  }
  const owners = [...groups.values()].sort((a, b) => b.totalValueCents - a.totalValueCents);

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <p className="font-mono text-xs font-bold text-primary">Sponsors</p>
      <h1 className="mt-2 text-[clamp(2.5rem,8vw,5rem)] leading-[0.88] font-extrabold tracking-[-0.05em]">
        Top sponsors
      </h1>
      <p className="mt-4 max-w-2xl text-muted-foreground">
        The brands sponsoring the most valuable profiles, ranked by current sponsorship value.
      </p>

      {numberOne?.owner ? (
        <section className="mt-9 border-2 border-border bg-accent p-5 text-accent-foreground sm:p-7">
          <div className="flex items-center gap-2 font-mono text-xs font-extrabold">
            <Trophy className="size-4" /> Sponsors the #1 profile
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <div className="text-3xl font-extrabold">{numberOne.owner.company_name}</div>
              <Link
                to="/u/$username"
                params={{ username: numberOne.creator.username }}
                className="mt-2 inline-block font-mono font-bold underline"
              >
                @{numberOne.creator.x_username ?? numberOne.creator.social_handle}
              </Link>
            </div>
            <div className="sm:text-right">
              <div className="label-xs !text-accent-foreground/60">Sponsorship value</div>
              <div className="text-4xl font-extrabold">{money(numberOne.bioValueCents ?? 0)}</div>
            </div>
          </div>
          <a
            href={`https://x.com/intent/post?text=${encodeURIComponent(
              `${numberOne.owner.company_name} holds the #1 creator sponsorship on SocialBid.`,
            )}&url=${encodeURIComponent(`https://socialbid.co/u/${numberOne.creator.username}`)}`}
            target="_blank"
            rel="noreferrer"
            className="mt-6 inline-flex items-center gap-2 text-sm font-extrabold underline"
          >
            <Share2 className="size-4" /> Share on X
          </a>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="owner-rankings">
        <h2 id="owner-rankings" className="mb-3 text-xl font-extrabold">
          Sponsor rankings
        </h2>
        {owners.length ? (
          <div className="border-t-2 border-border">
            {owners.map((owner, index) => (
              <div
                key={owner.name}
                className="grid gap-3 border-x-2 border-b-2 border-border bg-card p-4 sm:grid-cols-[3rem_1fr_auto] sm:items-center sm:gap-5 sm:px-5"
              >
                <div className="font-mono text-2xl font-extrabold">#{index + 1}</div>
                <div>
                  <div className="text-lg font-extrabold">{owner.name}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {owner.bios.map((row) => (
                      <Link
                        key={row.listing.id}
                        to="/u/$username"
                        params={{ username: row.creator.username }}
                        className="font-mono underline"
                      >
                        #{row.globalRank} @{row.creator.x_username ?? row.creator.social_handle}
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="sm:text-right">
                  <div className="label-xs">Total sponsorship value</div>
                  <div className="text-xl font-extrabold">{money(owner.totalValueCents)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="border-2 border-border bg-card p-8 text-center text-muted-foreground">
            No sponsor holds a production-paid profile yet.
          </div>
        )}
      </section>
    </div>
  );
}
