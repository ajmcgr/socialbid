import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  getAdminData,
  adminAction,
  getAdminTransactions,
  adminTransactionAction,
  type AdminTransaction,
} from "@/lib/admin.functions";
import { getSupabase } from "@/integrations/supabase/browser";
import { money, hostOf } from "@/lib/format";
import { CreatorShareCard } from "@/components/CreatorShareCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ShareCardData } from "@/lib/share-card";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin — SocialBid" },
      { name: "description", content: "Internal dashboard for SocialBid." },
      { property: "og:title", content: "Admin — SocialBid" },
      { property: "og:description", content: "Internal dashboard." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Admin,
});

type Data = Awaited<ReturnType<typeof getAdminData>>;

function Admin() {
  const load = useServerFn(getAdminData);
  const act = useServerFn(adminAction);
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shareCard, setShareCard] = useState<ShareCardData | null>(null);

  const refresh = useCallback(
    async (t: string) => {
      const res = await load({ data: { token: t } });
      if ("error" in res) setError(res.error);
      else {
        setError(null);
        setData(res);
      }
    },
    [load],
  );

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) {
      setError("Auth is not configured.");
      return;
    }

    let active = true;

    const applySession = async (accessToken: string | null) => {
      if (!active) return;
      setToken(accessToken);
      if (!accessToken) {
        setData(null);
        setError("Sign in at /auth first.");
        return;
      }
      setError(null);
      await refresh(accessToken);
    };

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      // getSession below owns initial restoration. Ignoring INITIAL_SESSION
      // prevents a stale empty startup event from replacing a valid session.
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void applySession(session?.access_token ?? null);
      } else if (event === "SIGNED_OUT") {
        void applySession(null);
      }
    });

    void (async () => {
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setError("Your sign-in session could not be restored. Please sign in again.");
        return;
      }

      let session = sessionData.session;
      if (session?.expires_at && session.expires_at * 1000 <= Date.now() + 60_000) {
        const { data: refreshedData, error: refreshError } = await sb.auth.refreshSession();
        if (!active) return;
        if (refreshError) {
          setError("Your sign-in session expired. Please sign in again.");
          return;
        }
        session = refreshedData.session;
      }

      await applySession(session?.access_token ?? null);
    })();

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [refresh]);

  async function run(action: string, id: string) {
    if (!token) return;
    await act({ data: { token, action: action as never, id } });
    await refresh(token);
  }

  if (error) return <p className="p-16 text-center font-bold">{error}</p>;
  if (!data || "error" in data) return <p className="p-16 text-center">Loading…</p>;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12">
      <h1 className="text-3xl font-extrabold">Admin</h1>

      <div className="panel mt-6 grid grid-cols-2 sm:grid-cols-4">
        {[
          ["GMV", money(data.gmvCents)],
          ["Creators", String(data.creators.length)],
          ["Active owners", String(data.active.length)],
          ["Payments", String(data.payments.length)],
        ].map(([l, v]) => (
          <div key={l} className="border-border px-5 py-4 not-last:border-r-2">
            <div className="label-xs">{l}</div>
            <div className="text-xl font-extrabold">{v}</div>
          </div>
        ))}
      </div>

      {token && <Transactions token={token} />}

      <h2 className="mt-10 text-lg font-extrabold">Creators</h2>
      <div className="panel mt-3 divide-y-2 divide-border">
        {data.creators.map((c) => {
          const listing = data.listings.find((l) => l.creator_id === c.id);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-bold">{c.display_name}</span>
              <span className="font-mono text-muted-foreground">@{c.social_handle}</span>
              <span className="bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                {c.x_account_verified ? "X connected" : "X not connected"}
              </span>
              <span className="bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
                {c.x_bio_verified
                  ? `profile verified (${c.x_bio_verified_method ?? "api"})`
                  : "profile unverified"}
              </span>
              <span
                className={`px-1.5 py-0.5 font-mono text-[10px] ${
                  listing?.status === "active"
                    ? "bg-foreground text-background"
                    : "border border-border"
                }`}
              >
                {listing?.status === "active" ? "Listed" : "Not listed"}
              </span>
              {c.banned && (
                <span className="bg-destructive px-1.5 py-0.5 font-mono text-[10px] text-destructive-foreground">
                  BANNED
                </span>
              )}
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    run(
                      c.verification_status === "verified" ? "unverify_creator" : "verify_creator",
                      c.id,
                    )
                  }
                  className="border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent"
                >
                  {c.verification_status === "verified" ? "Unverify" : "Verify"}
                </button>
                <button
                  onClick={() => run(c.x_bio_verified ? "unverify_bio" : "verify_bio", c.id)}
                  className="border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent"
                >
                  {c.x_bio_verified ? "Unverify profile" : "Verify profile"}
                </button>
                <button
                  onClick={() => run(c.banned ? "unban_creator" : "ban_creator", c.id)}
                  className="border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent"
                >
                  {c.banned ? "Unban" : "Ban"}
                </button>
                {listing && (
                  <button
                    onClick={() =>
                      run(
                        listing.status === "active" ? "pause_listing" : "activate_listing",
                        listing.id,
                      )
                    }
                    className="border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent"
                  >
                    {listing.status === "active" ? "Pause listing" : "Activate listing"}
                  </button>
                )}
                {data.shareCards.find((card) => card.creatorId === c.id) ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const card = data.shareCards.find((item) => item.creatorId === c.id);
                      if (card) setShareCard(card);
                    }}
                  >
                    Share card
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={Boolean(shareCard)} onOpenChange={(open) => !open && setShareCard(null)}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto border-2">
          <DialogHeader>
            <DialogTitle>Share creator announcement</DialogTitle>
            <DialogDescription>
              This card uses the creator’s current live marketplace details.
            </DialogDescription>
          </DialogHeader>
          {shareCard ? <CreatorShareCard data={shareCard} compact /> : null}
        </DialogContent>
      </Dialog>

      <h2 className="mt-10 text-lg font-extrabold">Active owners</h2>
      <div className="panel mt-3 divide-y-2 divide-border">
        {data.active.map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
            <span className="font-bold">{o.company_name}</span>
            <span className="text-muted-foreground">{hostOf(o.destination_url)}</span>
            <span>{money(o.amount_cents)}</span>
            <span className="text-muted-foreground">{o.click_count} clicks</span>
            <button
              onClick={() =>
                run(o.destination_disabled ? "enable_destination" : "disable_destination", o.id)
              }
              className="ml-auto border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent"
            >
              {o.destination_disabled ? "Enable link" : "Disable link"}
            </button>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-lg font-extrabold">Payouts & sponsorship status</h2>
      <div className="panel mt-3 divide-y-2 divide-border">
        {data.payouts.map((p) => (
          <div key={p.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-4 sm:items-center">
            <span className="font-bold">{money(p.amount_cents)}</span>
            <span className="font-mono text-xs">{p.status}</span>
            <span className="font-mono text-xs">
              sponsorship: {p.bio_verification_status}
              {p.last_bio_verified_at
                ? ` · ok ${new Date(p.last_bio_verified_at).toLocaleDateString()}`
                : ""}
            </span>
            <span className="truncate text-xs text-muted-foreground sm:text-right">
              {p.verification_failure_reason ?? p.last_verification_error ?? p.last_error ?? "—"}
            </span>
          </div>
        ))}
        {data.payouts.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">No payouts yet.</div>
        )}
      </div>

      <h2 className="mt-10 text-lg font-extrabold">Placement violations</h2>
      <div className="panel mt-3 divide-y-2 divide-border">
        {data.violations.map((v) => (
          <div key={v.id} className="flex flex-wrap gap-3 px-4 py-3 text-sm">
            <span className="font-mono text-xs">{v.phase}</span>
            <span className="font-bold">{v.reason}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {new Date(v.created_at).toLocaleString()}
            </span>
          </div>
        ))}
        {data.violations.length === 0 && (
          <div className="px-4 py-3 text-sm text-muted-foreground">None recorded.</div>
        )}
      </div>

      <h2 className="mt-10 text-lg font-extrabold">Recent payments</h2>
      <div className="panel mt-3 divide-y-2 divide-border">
        {data.payments.map((p) => (
          <div key={p.id} className="grid grid-cols-4 gap-2 px-4 py-3 text-sm">
            <span className="truncate font-bold">{p.company_name}</span>
            <span className="truncate text-muted-foreground">{p.email}</span>
            <span>{money(p.amount_cents)}</span>
            <span className="text-right font-mono text-xs">
              {p.flagged ? "flagged · " : ""}
              {p.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const BUCKETS = [
  ["attention", "Needs attention"],
  ["awaiting", "Awaiting activation"],
  ["active", "Active"],
  ["pending_payout", "Pending payouts"],
  ["refunded", "Refunded"],
  ["failed", "Failed / non-compliant"],
] as const;

const when = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");

function Transactions({ token }: { token: string }) {
  const load = useServerFn(getAdminTransactions);
  const act = useServerFn(adminTransactionAction);
  const [rows, setRows] = useState<AdminTransaction[] | null>(null);
  const [tab, setTab] = useState<(typeof BUCKETS)[number][0]>("attention");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await load({ data: { token } });
    if (!("error" in res)) setRows(res.rows);
  }, [load, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: string, paymentId: string) {
    setBusy(`${action}:${paymentId}`);
    const res = await act({ data: { token, action: action as never, paymentId } });
    setBusy(null);
    setNote("error" in res ? res.error : `${action}: ${res.result}`);
    await refresh();
  }

  if (!rows) return <p className="mt-10 text-sm text-muted-foreground">Loading transactions…</p>;

  const counts = Object.fromEntries(
    BUCKETS.map(([id]) => [id, rows.filter((r) => r.bucket === id).length]),
  ) as Record<string, number>;
  const visible = rows.filter((r) => r.bucket === tab);

  return (
    <section className="mt-10">
      <h2 className="text-lg font-extrabold">Transactions</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {BUCKETS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`border-2 border-border px-3 py-1.5 text-xs font-bold ${
              tab === id ? "bg-foreground text-background" : "hover:bg-accent"
            }`}
          >
            {label} ({counts[id] ?? 0})
          </button>
        ))}
      </div>
      {note && <p className="mt-3 font-mono text-xs">{note}</p>}

      <div className="panel mt-3 divide-y-2 divide-border">
        {visible.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">Nothing here.</p>
        )}
        {visible.map((t) => (
          <div key={t.paymentId} className="px-4 py-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold">{t.buyer}</span>
              <span className="text-muted-foreground">{t.buyerEmail}</span>
              <span className="font-mono">@{t.creator}</span>
              <span className="font-mono font-bold">{money(t.amountCents)}</span>
              {t.adminReview && (
                <span className="bg-destructive px-1.5 py-0.5 font-mono text-[10px] text-destructive-foreground">
                  ADMIN REVIEW
                </span>
              )}
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
              <span>payment: {t.paymentStatus}</span>
              <span>
                ownership: {t.ownershipStatus ?? "—"} / {t.placementStatus ?? "—"}
              </span>
              <span>activation deadline: {when(t.activationDeadline)}</span>
              <span>first verified: {when(t.firstVerifiedAt)}</span>
              <span>
                verification: {t.verificationStatus ?? "—"}
                {t.verificationError ? ` (${t.verificationError})` : ""}
              </span>
              <span>
                final verification: {t.finalVerification ?? "—"}
                {t.finalVerifiedAt ? ` · ${when(t.finalVerifiedAt)}` : ""}
              </span>
              <span>
                mismatch:{" "}
                {t.mismatchPendingSince
                  ? `pending confirmation since ${when(t.mismatchPendingSince)}`
                  : "—"}
                {t.mismatchReason ? ` · ${t.mismatchReason}` : ""}
              </span>
              <span>
                payout: {t.payoutStatus ?? "—"} · release {when(t.releaseAt)}
              </span>
              <span>transfer: {t.stripeTransferId ?? "—"}</span>
              <span>
                refund: {t.refundStatus}
                {t.refundReason ? ` · ${t.refundReason}` : ""}
                {t.stripeRefundId ? ` · ${t.stripeRefundId}` : ""}
              </span>
              {t.refundError && (
                <span className="text-destructive">refund error: {t.refundError}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {["retry_refund", "retry_verification", "retry_payout", "clear_review"].map((a) => (
                <button
                  key={a}
                  disabled={busy === `${a}:${t.paymentId}`}
                  onClick={() => run(a, t.paymentId)}
                  className="border-2 border-border px-2 py-1 text-xs font-bold hover:bg-accent disabled:opacity-40"
                >
                  {a.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
