/**
 * Held creator payouts.
 *
 * Money flows: buyer -> platform Stripe balance (immediately, on checkout).
 * A `payouts` row is created in `pending` with a hold window. Nothing leaves
 * the platform until ALL of the following are true at release time:
 *   - the hold window has elapsed
 *   - the payment is still `applied` and not refunded, live-mode
 *   - the sponsorship was created on SocialBid.co
 *   - the creator's connected account has transfers enabled
 */

import { admin } from "./db.server";
import { WEBSITE_ONLY_SPONSORSHIP } from "./placement";

const PAYOUT_HOLD_DAYS = 7;

/**
 * Ensures the applied payment has its one creator payout. The database unique
 * constraint on payment_id makes webhook and success-page retries safe.
 */
export async function recordPayout(opts: {
  paymentId: string;
  listingId: string;
  ownershipId: string | null;
  grossCents: number;
}) {
  const db = admin();
  // `hold_until` is NOT NULL in the base schema. Website-only settlement
  // fulfils the placement immediately, and markActivated below confirms this
  // same hold window before any transfer can become due.
  const initialHoldUntil = new Date(Date.now() + PAYOUT_HOLD_DAYS * 86_400_000).toISOString();

  const { data: listing } = await db
    .from("listings")
    .select("id, creator_id, platform_fee_percentage")
    .eq("id", opts.listingId)
    .maybeSingle();
  if (!listing) throw new Error("payout listing is missing");

  const feePct = Number(listing.platform_fee_percentage ?? 20);
  const feeCents = Math.round((opts.grossCents * feePct) / 100);
  const netCents = Math.max(0, opts.grossCents - feeCents);

  // The settlement path marks website delivery immediately and starts the
  // standard hold from the successful payment time.
  const { error } = await db.from("payouts").insert({
    creator_id: listing.creator_id,
    listing_id: listing.id,
    payment_id: opts.paymentId,
    ownership_id: opts.ownershipId,
    gross_cents: opts.grossCents,
    fee_cents: feeCents,
    amount_cents: netCents,
    fee_percentage: feePct,
    hold_until: initialHoldUntil,
    release_at: null,
    first_verified_at: null,
    payout_status: "not_eligible",
    status: "pending",
  });
  // A duplicate key just means a prior settlement attempt already created the
  // payout. Any other failure must reach the webhook so Stripe retries it.
  if (error && error.code !== "23505") {
    throw new Error(`recordPayout failed: ${error.message}`);
  }
}

export type ReleaseSummary = {
  considered: number;
  paid: number;
  blocked: number;
  failed: number;
  details: { payoutId: string; result: string }[];
};

/** Releases every payout whose hold has elapsed and whose checks still pass. */
export async function releaseDuePayouts(limit = 25): Promise<ReleaseSummary> {
  const db = admin();
  const summary: ReleaseSummary = {
    considered: 0,
    paid: 0,
    blocked: 0,
    failed: 0,
    details: [],
  };

  const { data: due } = await db
    .from("payouts")
    .select("id, creator_id, payment_id, amount_cents, attempts")
    .in("status", ["pending", "blocked"])
    .not("first_verified_at", "is", null)
    .not("release_at", "is", null)
    .lte("release_at", new Date().toISOString())
    .order("release_at", { ascending: true })
    .limit(limit);

  for (const payout of due ?? []) {
    summary.considered += 1;
    try {
      const result = await releaseOne(payout.id);
      summary.details.push({ payoutId: payout.id, result });
      if (result === "paid") summary.paid += 1;
      else summary.blocked += 1;
    } catch (e) {
      summary.failed += 1;
      summary.details.push({ payoutId: payout.id, result: `failed: ${String(e)}` });
      // A release exception can be transient (for example, a temporary Stripe
      // or network failure). Keep the payout eligible for the next hourly run
      // instead of moving it to the terminal `failed` state. Stripe transfer
      // idempotency is keyed by payout id, so retrying cannot pay twice even if
      // Stripe accepted a transfer just before this attempt lost its response.
      await db
        .from("payouts")
        .update({ status: "blocked", payout_status: "blocked", last_error: String(e) })
        .eq("id", payout.id);
    }
  }

  return summary;
}

async function block(payoutId: string, reason: string): Promise<string> {
  await admin()
    .from("payouts")
    .update({ status: "blocked", payout_status: "blocked", last_error: reason })
    .eq("id", payoutId);
  return `blocked: ${reason}`;
}

/** Runs all guards for one payout and, when they pass, transfers the funds. */
export async function releaseOne(payoutId: string): Promise<string> {
  const db = admin();

  const { data: payout } = await db
    .from("payouts")
    .select(
      "id, creator_id, payment_id, amount_cents, status, attempts, first_verified_at, release_at",
    )
    .eq("id", payoutId)
    .maybeSingle();
  if (!payout) return "blocked: payout_missing";
  if (payout.status === "paid") return "paid";
  if (payout.status === "cancelled") return "blocked: cancelled";
  // Website-only settlement marks the sponsorship live at payment time.
  if (!payout.first_verified_at) return block(payoutId, "never_activated");
  if (!payout.release_at || new Date(payout.release_at).getTime() > Date.now())
    return "blocked: hold_not_elapsed";
  if (payout.amount_cents < 100) return block(payoutId, "amount_below_stripe_minimum");

  await db
    .from("payouts")
    .update({ attempts: Number(payout.attempts ?? 0) + 1 })
    .eq("id", payoutId);

  const { data: payment } = await db
    .from("payments")
    .select(
      "id, status, refund_status, stripe_livemode, stripe_payment_intent, flagged, bio_message",
    )
    .eq("id", payout.payment_id)
    .maybeSingle();
  if (!payment) return block(payoutId, "payment_missing");
  if (payment.refund_status && payment.refund_status !== "none") {
    await db
      .from("payouts")
      .update({ status: "cancelled", payout_status: "blocked", last_error: "payment_refunded" })
      .eq("id", payoutId);
    return "blocked: payment_refunded";
  }
  if (payment.flagged) return block(payoutId, "payment_flagged");
  if (payment.status !== "applied") return block(payoutId, "payment_not_applied");
  if (!payment.stripe_livemode) return block(payoutId, "test_mode_payment");

  const { data: creator } = await db
    .from("creators")
    .select(
      "id, username, banned, x_user_id, x_bio_verified, stripe_account_id, stripe_payouts_enabled",
    )
    .eq("id", payout.creator_id)
    .maybeSingle();
  if (!creator) return block(payoutId, "creator_missing");
  if (creator.banned) return block(payoutId, "creator_banned");
  if (!creator.stripe_account_id) return block(payoutId, "no_connected_account");

  // Re-check the connected account rather than trusting the cached flag.
  const { retrieveAccount, retrievePaymentIntent, createTransfer } =
    await import("./stripe.server");
  const account = (await retrieveAccount(creator.stripe_account_id)) as Record<string, unknown>;
  const payoutsEnabled = account["payouts_enabled"] === true;
  const transfersActive =
    ((account["capabilities"] as Record<string, string> | undefined)?.["transfers"] ?? "") ===
    "active";
  await db
    .from("creators")
    .update({
      stripe_payouts_enabled: payoutsEnabled,
      stripe_details_submitted: account["details_submitted"] === true,
    })
    .eq("id", creator.id);
  if (!payoutsEnabled || !transfersActive) return block(payoutId, "onboarding_incomplete");

  // Each purchase has its own payout and its own hold. The placement only has
  // to be live while THIS buyer is still the current owner — being legitimately
  // outbid ends the obligation and keeps the payout eligible.
  // Select every column: naming optional lifecycle columns explicitly makes the
  // whole read fail (and look like a missing ownership) on any environment where
  // a later migration has not been applied yet.
  const { data: ownership, error: ownershipError } = await db
    .from("ownerships")
    .select("*")
    .eq("payment_id", payout.payment_id)
    .maybeSingle();
  if (ownershipError) return block(payoutId, `ownership_read_failed: ${ownershipError.message}`);

  const now = new Date().toISOString();

  // Website-only sponsorships are fulfilled on socialbid.co at purchase time.
  // Payment, ownership and the live placement are the only conditions, so no
  // X read gates the money — being outbid later never invalidates this payout.
  if (WEBSITE_ONLY_SPONSORSHIP) {
    if (!ownership) return block(payoutId, "ownership_missing");
    await db
      .from("payouts")
      .update({
        bio_verification_status: "verified",
        final_verification_status: "verified",
        last_verification_attempt_at: now,
        last_verification_error: null,
      })
      .eq("id", payoutId);
    return transferPayout(
      payoutId,
      payout,
      payment,
      creator,
      retrievePaymentIntent,
      createTransfer,
    );
  }

  const endReason = (ownership?.placement_end_reason as string | null) ?? null;

  const placementStatus = (ownership?.placement_status as string | null) ?? null;
  if (
    placementStatus === "superseded_before_activation" ||
    placementStatus === "activation_failed" ||
    endReason === "superseded_before_activation" ||
    endReason === "activation_failed"
  ) {
    await db
      .from("payouts")
      .update({
        status: "cancelled",
        payout_status: "blocked",
        last_error: "never_activated",
      })
      .eq("id", payoutId);
    return "blocked: never_activated";
  }

  if (
    endReason === "seller_removed" ||
    placementStatus === "non_compliant" ||
    ownership?.bio_verification_status === "failed" ||
    ownership?.final_verification_status === "failed"
  ) {
    await db
      .from("payouts")
      .update({
        status: "cancelled",
        payout_status: "blocked",
        bio_verification_status: "failed",
        final_verification_status: "failed",
        last_error: "placement_verification_failed",
      })
      .eq("id", payoutId);
    return "blocked: placement_verification_failed";
  }

  const stillCurrentOwner = !ownership || ownership.status === "active";

  if (!stillCurrentOwner) {
    // The ownership ended. It is payout-eligible ONLY when the fresh read taken
    // at the transition succeeded — an OUTBID row alone proves nothing, and we
    // never re-read X now (the old sponsor is no longer expected in the bio).
    const finalStatus = (ownership?.final_verification_status as string | null) ?? null;
    if (finalStatus !== "verified") {
      return block(
        payoutId,
        finalStatus === "unresolved" || finalStatus === null
          ? "awaiting_final_transition_verification"
          : `final_verification_${finalStatus}`,
      );
    }
    await db
      .from("payouts")
      .update({
        bio_verification_status: "verified",
        final_verification_status: "verified",
        final_verified_at: (ownership?.final_verified_at as string | null) ?? now,
        last_verification_attempt_at: now,
        last_verification_error: null,
      })
      .eq("id", payoutId);
    return transferPayout(
      payoutId,
      payout,
      payment,
      creator,
      retrievePaymentIntent,
      createTransfer,
    );
  }

  // An unconfirmed mismatch is being re-checked: hold the money, don't punish.
  if (ownership?.mismatch_pending_since) {
    return block(payoutId, "mismatch_pending_confirmation");
  }

  const { checkPlacement } = await import("./verification.server");
  const result = await checkPlacement({
    creatorId: creator.id,
    username: creator.username,
    xUserId: creator.x_user_id ? String(creator.x_user_id) : null,
    message:
      ((ownership?.bio_message as string | null) ??
        (payment as { bio_message?: string | null }).bio_message) ||
      null,
    url: (ownership?.destination_url as string | null) ?? null,
    placementFormat: (ownership?.placement_format as string | null) ?? null,
  });

  if (result.outcome === "unavailable") {
    // Technical failure — never punish the creator, just retry next run.
    await db
      .from("payouts")
      .update({ last_verification_attempt_at: now, last_verification_error: result.error })
      .eq("id", payoutId);
    return block(payoutId, `unable_to_verify: ${result.error}`);
  }

  if (result.outcome === "mismatch") {
    // Race guard: a newer buyer may have taken over between the two reads. That
    // transition carries its own final verification, so defer to it.
    if (ownership) {
      const { data: fresh } = await db
        .from("ownerships")
        .select("*")
        .eq("id", ownership.id)
        .maybeSingle();

      if (fresh && fresh.status !== "active" && fresh.placement_end_reason !== "seller_removed") {
        if (fresh.final_verification_status !== "verified")
          return block(payoutId, "awaiting_final_transition_verification");
        await db
          .from("payouts")
          .update({
            bio_verification_status: "verified",
            final_verification_status: "verified",
            last_verification_attempt_at: now,
            last_verification_error: null,
          })
          .eq("id", payoutId);
        return transferPayout(
          payoutId,
          payout,
          payment,
          creator,
          retrievePaymentIntent,
          createTransfer,
        );
      }

      // Still the current owner: one confirmed mismatch is not terminal.
      const { data: listingRow } = await db
        .from("listings")
        .select("id")
        .eq("creator_id", creator.id)
        .maybeSingle();
      const { registerActiveMismatch } = await import("./verification.server");
      const outcome = await registerActiveMismatch(
        {
          ownershipId: ownership.id,
          listingId: String(listingRow?.id ?? ""),
          paymentId: payout.payment_id,
          creatorId: creator.id,
          payoutId,
          payoutStatus: payout.status as string,
        },
        result.reason,
        result.snapshot,
        "hold",
        (fresh?.mismatch_pending_since as string | null) ??
          (ownership.mismatch_pending_since as string | null) ??
          null,
        (fresh?.mismatch_recheck_at as string | null) ?? null,
      );
      if (outcome === "pending") return block(payoutId, "mismatch_pending_confirmation");
      return `blocked: verification_failed: ${result.reason}`;
    }

    await db
      .from("payouts")
      .update({
        status: "cancelled",
        payout_status: "blocked",
        bio_verification_status: "failed",
        verification_failure_at: now,
        verification_failure_reason: result.reason,
        last_verification_attempt_at: now,
        last_error: `verification_failed: ${result.reason}`,
      })
      .eq("id", payoutId);
    return `blocked: verification_failed: ${result.reason}`;
  }

  await db
    .from("payouts")
    .update({
      bio_verification_status: "verified",
      last_bio_verified_at: now,
      last_verification_attempt_at: now,
      last_verification_error: null,
    })
    .eq("id", payoutId);
  if (ownership)
    await db
      .from("ownerships")
      .update({
        bio_verification_status: "verified",
        last_bio_verified_at: now,
        last_verification_attempt_at: now,
        last_verification_error: null,
      })
      .eq("id", ownership.id);

  return transferPayout(payoutId, payout, payment, creator, retrievePaymentIntent, createTransfer);
}

type PayoutRow = { id: string; payment_id: string; amount_cents: number };
type PaymentRow = { stripe_payment_intent: string | null };
type CreatorRow = { stripe_account_id: string };

/** Moves the money. Assumes every eligibility guard already passed. */
async function transferPayout(
  payoutId: string,
  payout: PayoutRow,
  payment: PaymentRow,
  creator: CreatorRow,
  retrievePaymentIntent: (id: string) => Promise<unknown>,
  createTransfer: (opts: {
    amountCents: number;
    destination: string;
    sourceTransaction: string | null;
    payoutId: string;
    paymentId: string;
  }) => Promise<Record<string, unknown>>,
): Promise<string> {
  const db = admin();

  // Final guard immediately before moving money: a refund may have landed
  // while the earlier checks were running, and a concurrent run may have
  // already paid this out. The Stripe idempotency key (bmb_payout_<id>)
  // makes a duplicate transfer impossible even in a race.
  const { data: guard } = await db
    .from("payouts")
    .select("status, payments!inner(refund_status, stripe_refund_id)")
    .eq("id", payoutId)
    .maybeSingle();
  if (guard) {
    if (guard.status === "paid") return "paid";
    const linked = guard.payments as unknown as {
      refund_status: string | null;
      stripe_refund_id: string | null;
    } | null;
    if (
      linked &&
      ((linked.refund_status && linked.refund_status !== "none") || linked.stripe_refund_id)
    ) {
      await db
        .from("payouts")
        .update({ status: "cancelled", payout_status: "blocked", last_error: "payment_refunded" })
        .eq("id", payoutId);
      return "blocked: payment_refunded";
    }
  }

  // Prefer settling against the original charge so the funds are traceable.
  let sourceTransaction: string | null = null;
  if (payment.stripe_payment_intent) {
    try {
      const pi = (await retrievePaymentIntent(payment.stripe_payment_intent)) as Record<
        string,
        unknown
      >;
      const charge = pi["latest_charge"];
      if (typeof charge === "string") sourceTransaction = charge;
    } catch (e) {
      console.error("payment intent lookup failed", e);
    }
  }

  const transfer = await createTransfer({
    amountCents: payout.amount_cents,
    destination: creator.stripe_account_id,
    sourceTransaction,
    payoutId: payout.id,
    paymentId: payout.payment_id,
  });

  await db
    .from("payouts")
    .update({
      status: "paid",
      payout_status: "released",
      released_at: new Date().toISOString(),
      stripe_transfer_id: String(transfer["id"]),
      last_error: null,
    })
    .eq("id", payoutId);

  const { recordEvent } = await import("./events.server");
  await recordEvent("payout_released", {
    paymentId: payout.payment_id,
    payoutId,
    detail: { amount_cents: payout.amount_cents, transfer_id: String(transfer["id"]) },
  });

  try {
    const { data: payoutRow } = await db
      .from("payouts")
      .select("creator_id")
      .eq("id", payoutId)
      .maybeSingle();
    if (payoutRow?.creator_id) {
      const { creatorEmail } = await import("./notify.server");
      const to = await creatorEmail(String(payoutRow.creator_id));
      if (to) {
        const { sendPayoutReleasedEmail } = await import("./email.server");
        await sendPayoutReleasedEmail({ to, amountCents: payout.amount_cents });
      }
    }
  } catch (e) {
    console.error("payout email failed", e);
  }

  return "paid";
}
