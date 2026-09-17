import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { CreatorShareCard } from "@/components/CreatorShareCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCreatorSession,
  getCreatorAuthState,
  disconnectXAccount,
  publishListing,
  updateNotificationEmail,
  type CreatorSession,
} from "@/lib/creator.functions";
import { getSupabase } from "@/integrations/supabase/browser";
import {
  getPayoutStatus,
  startPayoutOnboarding,
  refreshPayoutAccount,
  payoutDashboardLink,
  type PayoutStatus,
} from "@/lib/payouts.functions";
import { trackEvent } from "@/lib/listing.functions";
import { money } from "@/lib/format";

export const Route = createFileRoute("/creator")({
  head: () => ({
    meta: [
      { title: "Add Your Profile — SocialBid" },
      {
        name: "description",
        content: "Connect X, add your profile, and let anyone sponsor you on SocialBid.",
      },
      { property: "og:title", content: "Add Your Profile — SocialBid" },
      {
        property: "og:description",
        content: "Connect X to confirm your identity, then add your profile to SocialBid.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CreatorPage,
});

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border-2 border-border px-3 py-1.5 font-mono text-xs font-bold ${
        on ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
      }`}
    >
      {on ? "✓" : "○"} {label}
    </span>
  );
}

function CreatorPage() {
  const [session, setSession] = useState<CreatorSession | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [payouts, setPayouts] = useState<PayoutStatus | null>(null);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const enterMarketSeen = useRef(false);

  const loadPayouts = useCallback(() => {
    void getPayoutStatus({ data: {} })
      .then((p) => setPayouts(p))
      // Keep previously loaded payout state through a temporary reconnect
      // failure; the global recovery event will try again.
      .catch(() => undefined);
  }, []);

  const loadCreatorSession = useCallback(() => {
    void Promise.all([getCreatorSession({ data: {} }), getCreatorAuthState({ data: {} })])
      .then(([s, auth]) => {
        setSession(s);
        setAuthenticated(auth);
        setNotificationEmail(s?.notificationEmail ?? "");
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err) setMessage(errorCopy(err));
    const connected = params.get("connected");
    if (connected && !err) {
      setMessage(`X connected — @${connected}`);
      void trackEvent({ data: { name: "x_auth_completed" } }).catch(() => undefined);
    }
    const stripeReturn = params.get("stripe");
    if (connected || stripeReturn) {
      window.history.replaceState({}, "", "/creator");
    }
    loadCreatorSession();

    if (stripeReturn) {
      void refreshPayoutAccount({ data: {} }).then(() => loadPayouts());
    } else {
      loadPayouts();
    }
    const recover = () => {
      loadCreatorSession();
      loadPayouts();
    };
    window.addEventListener("social-bid-recover", recover);
    return () => window.removeEventListener("social-bid-recover", recover);
  }, [loadCreatorSession, loadPayouts]);

  // Fire once per page view, only for a verified-but-unlisted creator.
  const showEnterMarket = Boolean(session && session.accountVerified && !session.publiclyListed);
  useEffect(() => {
    if (!showEnterMarket || enterMarketSeen.current) return;
    enterMarketSeen.current = true;
    void trackEvent({ data: { name: "enter_market_viewed" } }).catch(() => undefined);
  }, [showEnterMarket]);

  async function onPublish() {
    if (!session) return;
    setBusy(true);
    setPublishError(null);
    void trackEvent({ data: { name: "enter_market_clicked" } }).catch(() => undefined);
    const res = await publishListing({ data: {} }).catch(() => ({
      error: "We couldn't reach SocialBid. Check your connection and try again.",
    }));
    setBusy(false);
    if ("error" in res) {
      setPublishError(res.error);
      return;
    }
    void trackEvent({ data: { name: "listing_published" } }).catch(() => undefined);
    setMessage("You're in the market — your profile is live on SocialBid.");
    const next = await getCreatorSession({ data: {} });
    setSession(next);
    setShowShareDialog(true);
    window.dispatchEvent(new Event("creator-session-changed"));
  }

  async function onDisconnect(deleteData: boolean) {
    if (!session) return;
    const obligation = Boolean(session?.ownerMessage || session?.activation);
    const obligationWarning =
      "Disconnecting X will remove your profile from public rankings and stop it from accepting new sponsors. It does not cancel any current sponsorship or pending payout obligations.";
    const warn = deleteData
      ? "Disconnect X and delete your SocialBid data? This can't be undone."
      : "Disconnect X from SocialBid?";
    if (!window.confirm(obligation ? `${obligationWarning}\n\n${warn}` : warn)) return;
    setBusy(true);
    setMessage(null);
    const res = await disconnectXAccount({ data: { deleteData } });
    setBusy(false);
    if ("error" in res) {
      setMessage(res.error);
      return;
    }
    setSession(null);
    setPayouts(null);
    window.dispatchEvent(new Event("creator-session-changed"));
    setMessage(
      res.deleted
        ? "X is disconnected and your data has been deleted."
        : "hasObligation" in res && res.hasObligation
          ? "X is disconnected and your profile has been removed from public rankings. Your current sponsorship and any held payout continue under the existing rules."
          : "retained" in res && res.retained
            ? "X is disconnected. Your profile has been removed from public rankings. Past transaction records are retained."
            : "X is disconnected. Your profile has been removed from public rankings until you reconnect and add it again.",
    );
  }

  async function onSaveNotificationEmail() {
    if (!session) return;
    setBusy(true);
    const res = await updateNotificationEmail({ data: { email: notificationEmail } });
    setBusy(false);
    if ("error" in res) {
      setMessage(res.error);
      return;
    }
    setSession({ ...session, notificationEmail: res.notificationEmail });
    setNotificationEmail(res.notificationEmail);
    setMessage("Notification email saved.");
  }

  async function onAccountSignOut() {
    setBusy(true);
    const { signOutCanonicalSession } = await import("@/lib/session-bootstrap.functions");
    await signOutCanonicalSession({ data: {} });
    await getSupabase()?.auth.signOut({ scope: "local" });
    setSession(null);
    setAuthenticated(false);
    setBusy(false);
    window.dispatchEvent(new Event("creator-session-changed"));
  }

  return (
    <div className="mx-auto max-w-2xl px-5 py-14">
      <h1 className="text-[clamp(2rem,7vw,3.25rem)] leading-[0.9] font-semibold tracking-[-0.05em]">
        {authenticated ? "Profile" : "Add your profile"}
      </h1>
      <p className="mt-4 text-muted-foreground">
        Connect X to confirm your identity, then add your profile to SocialBid.
      </p>
      {session ? (
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="/inbox" className="btn-outline-ink">
            Inbox
          </a>
          <a href="/notifications" className="btn-outline-ink">
            Notifications
          </a>
        </div>
      ) : null}

      {message ? <div className="panel mt-6 px-4 py-3 text-sm font-medium">{message}</div> : null}

      {loading ? (
        <p className="mt-10 text-sm text-muted-foreground">Loading…</p>
      ) : authenticated && !session ? (
        <div className="panel mt-8 p-6">
          <div className="label-xs">Your SocialBid account</div>
          <h2 className="mt-1 text-xl font-semibold">Want to get sponsored?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add your X profile to enter the creator marketplace. This does not post to X or give
            sponsors access to your X account.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href="/api/public/x-start?next=%2Fcreator" className="btn-ink btn-ink-hover">
              Add your X profile
            </a>
            <button
              onClick={onAccountSignOut}
              disabled={busy}
              className="btn-outline-ink disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </div>
      ) : !session ? (
        <div className="panel mt-8 p-6">
          <div className="label-xs">Add your profile</div>
          <h2 className="mt-1 text-xl font-semibold">Connect X to confirm your identity</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your connection confirms your identity and imports your public profile. Sponsorships
            appear on SocialBid.
          </p>
          <a href="/api/public/x-start" className="btn-ink btn-ink-hover mt-6">
            Connect X
          </a>
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Used for identity verification only.
          </p>
        </div>
      ) : (
        <>
          <div className="panel mt-8 flex items-center gap-4 p-6">
            {session.profileImageUrl ? (
              <img
                src={session.profileImageUrl}
                alt={session.displayName}
                className="size-14 border-2 border-border"
              />
            ) : (
              <div className="flex size-14 items-center justify-center border-2 border-border bg-accent text-xl font-extrabold">
                {session.displayName.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-lg font-extrabold">{session.displayName}</div>
              <div className="font-mono text-sm text-muted-foreground">
                @{session.handle} · {session.followers.toLocaleString()} followers
              </div>
            </div>
          </div>

          {showEnterMarket ? (
            <div className="mt-6 border-4 border-border">
              <div className="flex items-center justify-between gap-3 border-b-4 border-border bg-foreground px-5 py-3 font-mono text-xs font-bold tracking-[0.14em] text-background uppercase">
                <span>✓ X profile verified</span>
                <span className="opacity-70">Not listed</span>
              </div>
              <div className="px-5 py-7 sm:px-7">
                <h2 className="text-[clamp(1.6rem,5vw,2.4rem)] leading-[0.95] font-semibold tracking-[-0.04em]">
                  You're ready to enter the market.
                </h2>
                <p className="mt-3 text-sm text-muted-foreground">
                  Get sponsored and build direct connections with the people and brands backing you.
                </p>

                <div className="mt-6 flex items-baseline gap-3 border-2 border-border px-4 py-3">
                  <span className="font-mono text-[0.65rem] font-bold tracking-[0.14em] uppercase">
                    Opening bid
                  </span>
                  <span className="text-2xl font-extrabold">
                    {money(session.startingPriceCents ?? 1000)}
                  </span>
                </div>

                {publishError ? (
                  <div
                    role="alert"
                    className="mt-5 border-2 border-destructive px-4 py-3 text-sm font-medium text-destructive"
                  >
                    {publishError}
                  </div>
                ) : null}

                <button
                  onClick={onPublish}
                  disabled={busy}
                  className="btn-ink btn-ink-hover mt-6 w-full justify-center text-base tracking-[0.05em] uppercase disabled:opacity-50 sm:w-auto"
                >
                  {busy
                    ? "Entering the market…"
                    : publishError
                      ? "Try again →"
                      : "Enter the market →"}
                </button>

                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  Your profile isn't public until you enter the market.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Nothing changes on X — sponsorships only appear on SocialBid, and you keep 80% of
                  every sponsorship.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Badge on={session.accountVerified} label="X connected" />
            <Badge on={session.publiclyListed} label="Profile live" />
          </div>

          <div className="panel mt-6 p-6">
            {!session.notificationEmail ? (
              <>
                <div className="label-xs">Don't miss a sponsor</div>
                <h2 className="mt-1 text-xl font-semibold">Add your email</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Add your email and we'll let you know when someone sponsors or outbids you.
                </p>
              </>
            ) : (
              <>
                <div className="label-xs">Email for notifications</div>
                <h2 className="mt-1 text-xl font-semibold">Notification email</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  We'll email you when someone sponsors or outbids your profile.
                </p>
              </>
            )}
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="email"
                value={notificationEmail}
                onChange={(event) => setNotificationEmail(event.target.value)}
                placeholder="you@example.com"
                aria-label="Email for notifications"
                className="min-w-0 flex-1 border-2 border-border bg-background px-3 py-2.5 text-sm outline-none"
              />
              <button
                type="button"
                onClick={onSaveNotificationEmail}
                disabled={busy}
                className="btn-ink btn-ink-hover shrink-0 disabled:opacity-50"
              >
                {busy ? "Saving…" : session.notificationEmail ? "Save email" : "Add email"}
              </button>
            </div>
          </div>

          {session.bioVerified ? (
            <div className="mt-8 border-2 border-border bg-foreground text-background">
              <div className="border-b border-background/25 px-5 py-3 font-mono text-xs font-bold">
                Your profile
              </div>
              <div className="grid sm:grid-cols-3">
                <div className="px-5 py-5 sm:border-r sm:border-background/25">
                  <div className="font-mono text-[0.65rem] font-bold text-background/60">
                    Sponsorship value
                  </div>
                  <div className="mt-1 text-3xl font-extrabold">
                    {session.bioValueCents === null ? "—" : money(session.bioValueCents)}
                  </div>
                </div>
                <div className="border-t border-background/25 px-5 py-5 sm:border-t-0 sm:border-r">
                  <div className="font-mono text-[0.65rem] font-bold text-background/60">
                    Global rank
                  </div>
                  <div className="mt-1 text-3xl font-extrabold">
                    {session.globalRank ? `#${session.globalRank}` : "Unranked"}
                  </div>
                </div>
                <div className="border-t border-background/25 px-5 py-5 sm:border-t-0">
                  <div className="font-mono text-[0.65rem] font-bold text-background/60">
                    Sponsored by
                  </div>
                  <div className="mt-1 truncate text-xl font-extrabold">
                    {session.ownerName ?? "No current sponsor"}
                  </div>
                </div>
              </div>
              {session.globalRank && session.bioValueCents !== null ? (
                <a
                  href={`https://x.com/intent/post?text=${encodeURIComponent(
                    `My sponsorship on SocialBid is now worth ${money(session.bioValueCents)}.\n\nCurrently #${session.globalRank}.`,
                  )}&url=${encodeURIComponent(`https://socialbid.co/u/${session.username}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 border-t border-background/25 px-5 py-4 font-extrabold hover:bg-background/10"
                >
                  <Share2 className="size-4" /> Share my rank
                </a>
              ) : null}
            </div>
          ) : null}

          {session.publiclyListed && session.startingPriceCents !== null ? (
            <section className="mt-8" aria-labelledby="share-profile-heading">
              <div className="label-xs">Creator announcement</div>
              <h2 id="share-profile-heading" className="mt-1 text-xl font-semibold">
                Share your profile
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Download your live market card or share your profile on X.
              </p>
              <CreatorShareCard
                data={{
                  username: session.username,
                  displayName: session.displayName,
                  handle: session.handle,
                  avatarUrl: session.profileImageUrl,
                  bio: session.bio,
                  startingPriceCents: session.startingPriceCents,
                  currentValueCents: session.bioValueCents,
                  globalRank: session.globalRank,
                  sponsorName: session.ownerName,
                  sponsorLogoUrl: session.ownerLogoUrl,
                }}
              />
            </section>
          ) : null}

          {session.publiclyListed && session.startingPriceCents !== null ? (
            <Dialog open={showShareDialog} onOpenChange={setShowShareDialog}>
              <DialogContent className="max-w-md sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Your profile is live!</DialogTitle>
                  <DialogDescription>
                    Share your announcement card to help sponsors find you on SocialBid.
                  </DialogDescription>
                </DialogHeader>
                <CreatorShareCard
                  compact
                  data={{
                    username: session.username,
                    displayName: session.displayName,
                    handle: session.handle,
                    avatarUrl: session.profileImageUrl,
                    bio: session.bio,
                    startingPriceCents: session.startingPriceCents,
                    currentValueCents: session.bioValueCents,
                    globalRank: session.globalRank,
                    sponsorName: session.ownerName,
                    sponsorLogoUrl: session.ownerLogoUrl,
                  }}
                />
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setShowShareDialog(false)}>
                    Maybe later
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}

          {session.ownerMessage ? (
            <div className="panel mt-8 p-6">
              <div className="label-xs">Sponsored on SocialBid</div>
              <h2 className="mt-1 text-xl font-semibold">
                Your sponsored slot is live on SocialBid
              </h2>
              <div className="mt-4 inline-block border-2 border-border bg-accent px-3 py-2 font-mono text-sm font-bold text-accent-foreground">
                {session.ownerPlacement ??
                  `${session.ownerMessage}${session.ownerUrl ? ` ${session.ownerUrl}` : ""}`}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Each sponsorship is paid out 7 days after purchase. Being outbid doesn't affect
                payouts you've already earned.
              </p>
            </div>
          ) : null}

          {session ? <PayoutsPanel status={payouts} onChange={loadPayouts} /> : null}

          <div className="panel mt-8 p-6">
            <div className="label-xs">Account</div>
            <h2 className="mt-1 text-xl font-extrabold">Disconnect X</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              This unlinks @{session.handle} and signs you out. Your profile stays permanently in
              internal records, but is removed from public rankings. Nobody can bid until you
              reconnect and add it again. Existing payment and payout records remain intact.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => onDisconnect(false)}
                disabled={busy}
                className="btn-outline-ink disabled:opacity-50"
              >
                {busy ? "Working…" : "Disconnect X"}
              </button>
              <button
                onClick={() => onDisconnect(true)}
                disabled={busy}
                className="btn-outline-ink text-destructive disabled:opacity-50"
              >
                Disconnect and delete my data
              </button>
            </div>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Profile status:{" "}
            <span className="font-mono font-bold">{session.listingStatus ?? "none"}</span>
            {session.bioVerified ? (
              <>
                {" "}
                — live at{" "}
                <a className="underline" href={`/u/${session.username}`}>
                  socialbid.co/u/{session.username}
                </a>
              </>
            ) : null}
          </p>
        </>
      )}
    </div>
  );
}

function errorCopy(code: string): string {
  switch (code) {
    case "x_not_configured":
      return "X sign-in isn't configured yet — X_CLIENT_ID and X_CLIENT_SECRET are missing.";
    case "x_denied":
      return "You cancelled the X authorisation. Nothing was connected.";
    case "x_callback_error":
      return "X returned an error during sign-in. Please try again.";
    case "x_already_connected":
      return "That X profile is already connected to another SocialBid creator.";
    case "x_account_conflict":
      return "This SocialBid account already has a different X profile connected.";
    case "missing_code":
      return "That sign-in didn't complete. Please connect again.";
    case "creator_create_failed":
      return "We couldn't create your creator profile. Please try again.";
    case "bad_state":
      return "That sign-in link expired. Please connect again.";
    case "handle_taken":
      return "That handle is already listed. Contact us if it's yours.";
    case "x_auth_failed":
      return "X sign-in failed. Please try again.";
    case "creator_identity_failed":
      return "We couldn't finish connecting your X account. Please try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}

function payoutLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Held until release";
    case "blocked":
      return "On hold — needs attention";
    case "paid":
      return "Paid out";
    case "cancelled":
      return "Cancelled (refunded)";
    default:
      return "Failed";
  }
}

function PayoutsPanel({ status, onChange }: { status: PayoutStatus | null; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConnect() {
    setBusy(true);
    setError(null);
    const res = await startPayoutOnboarding({ data: {} });
    if ("error" in res) {
      setError(res.error);
      setBusy(false);
      return;
    }
    window.location.href = res.url;
  }

  async function onDashboard() {
    setBusy(true);
    const res = await payoutDashboardLink({ data: {} });
    setBusy(false);
    if ("url" in res) window.open(res.url, "_blank", "noopener");
    else setError(res.error);
  }

  return (
    <div className="panel mt-8 p-6">
      <div className="label-xs">Step 3</div>
      <h2 className="mt-1 text-xl font-extrabold">Get paid</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Buyers pay SocialBid. We hold your share for 7 days, then transfer it to your bank via
        Stripe.
      </p>

      {status ? (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <Badge on={status.connected} label="Payout account created" />
            <Badge on={status.payoutsEnabled} label="Payouts enabled" />
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="border-2 border-border px-4 py-3">
              <div className="font-mono text-[0.65rem] font-bold text-muted-foreground">
                On hold
              </div>
              <div className="mt-1 text-2xl font-extrabold">{money(status.pendingCents)}</div>
            </div>
            <div className="border-2 border-border px-4 py-3">
              <div className="font-mono text-[0.65rem] font-bold text-muted-foreground">
                Paid out
              </div>
              <div className="mt-1 text-2xl font-extrabold">{money(status.paidCents)}</div>
            </div>
          </div>

          {status.items.length ? (
            <ul className="mt-5 divide-y divide-border border-2 border-border">
              {status.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold">{money(item.amountCents)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {payoutLabel(item.status)}
                      {item.status === "pending"
                        ? ` · releases ${new Date(item.holdUntil).toLocaleDateString()}`
                        : ""}
                      {item.status === "blocked" && item.note ? ` · ${item.note}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-xs text-muted-foreground">
                    of {money(item.grossCents)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              No sponsorships yet. Payouts appear here when someone sponsors your profile.
            </p>
          )}

          {error ? <p className="mt-4 text-sm font-medium text-destructive">{error}</p> : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              onClick={onConnect}
              disabled={busy || !status.configured}
              className="btn-ink btn-ink-hover disabled:opacity-50"
            >
              {busy
                ? "Opening Stripe…"
                : status.payoutsEnabled
                  ? "Update payout details"
                  : status.connected
                    ? "Finish payout setup"
                    : "Set up payouts"}
            </button>
            {status.connected ? (
              <button onClick={onDashboard} disabled={busy} className="btn-outline-ink">
                Stripe dashboard
              </button>
            ) : null}
            <button onClick={onChange} className="btn-outline-ink">
              Refresh
            </button>
          </div>
        </>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">Loading payouts…</p>
      )}
    </div>
  );
}
