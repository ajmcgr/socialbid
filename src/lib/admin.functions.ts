import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const tokenIn = z.object({ token: z.string().min(10) });

export const getAdminData = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => tokenIn.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./authz.server");
    const { admin } = await import("./db.server");
    const gate = await requireAdmin(data.token);
    if (!gate.ok) return { error: gate.error } as const;
    const db = admin();

    const [creators, listings, payments, ownerships, payouts, violations] = await Promise.all([
      db
        .from("creators")
        .select(
          "id, display_name, username, social_handle, verification_status, x_account_verified, x_bio_verified, x_bio_verified_method, banned, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("listings")
        .select(
          "id, creator_id, slug, status, starting_price_cents, compliance_status, non_compliant_reason",
        )
        .limit(200),
      db
        .from("payments")
        .select(
          "id, company_name, email, amount_cents, status, refund_status, stripe_livemode, flagged, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("ownerships")
        .select(
          "id, company_name, destination_url, amount_cents, status, click_count, destination_disabled",
        )
        .eq("status", "active")
        .limit(100),
      db
        .from("payouts")
        .select(
          "id, creator_id, amount_cents, status, hold_until, released_at, bio_verification_status, last_bio_verified_at, verification_failure_at, verification_failure_reason, last_verification_error, last_error",
        )
        .order("created_at", { ascending: false })
        .limit(50),
      db
        .from("placement_violations")
        .select("id, creator_id, phase, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const { loadMarketplace } = await import("./marketplace.server");
    const market = await loadMarketplace("most-valuable");
    const shareCards = [...market.rows, ...market.unowned].map((row) => ({
      creatorId: row.creator.id,
      username: row.creator.username,
      displayName: row.creator.display_name,
      handle: row.creator.x_username ?? row.creator.social_handle,
      avatarUrl: row.creator.profile_image_url,
      bio: row.creator.x_bio_snapshot ?? null,
      startingPriceCents: row.listing.starting_price_cents,
      currentValueCents: row.bioValueCents,
      globalRank: row.globalRank,
      sponsorName: row.owner?.company_name ?? null,
      sponsorLogoUrl: row.owner?.logo_url ?? null,
    }));

    const paid = (payments.data ?? []).filter(
      (p) => p.status === "applied" && p.stripe_livemode && p.refund_status !== "refunded",
    );
    return {
      creators: creators.data ?? [],
      listings: listings.data ?? [],
      payments: payments.data ?? [],
      active: ownerships.data ?? [],
      payouts: payouts.data ?? [],
      violations: violations.data ?? [],
      shareCards,
      gmvCents: paid.reduce((s, p) => s + p.amount_cents, 0),
    } as const;
  });

export const adminAction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    tokenIn
      .extend({
        action: z.enum([
          "verify_creator",
          "unverify_creator",
          "verify_bio",
          "unverify_bio",
          "ban_creator",
          "unban_creator",
          "pause_listing",
          "activate_listing",
          "disable_destination",
          "enable_destination",
        ]),
        id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./authz.server");
    const { admin } = await import("./db.server");
    const gate = await requireAdmin(data.token);
    if (!gate.ok) return { error: gate.error } as const;
    const db = admin();

    switch (data.action) {
      case "verify_creator":
        await db.from("creators").update({ verification_status: "verified" }).eq("id", data.id);
        break;
      case "unverify_creator":
        await db.from("creators").update({ verification_status: "pending" }).eq("id", data.id);
        break;
      case "verify_bio":
        // Manual fallback: only used when an admin has actually confirmed the
        // placement is present on the creator's live X profile.
        await db
          .from("creators")
          .update({
            x_bio_verified: true,
            x_bio_verified_at: new Date().toISOString(),
            x_bio_verified_method: "admin",
          })
          .eq("id", data.id);
        await db.from("listings").update({ status: "active" }).eq("creator_id", data.id);
        break;
      case "unverify_bio":
        await db
          .from("creators")
          .update({ x_bio_verified: false, x_bio_verified_at: null, x_bio_verified_method: null })
          .eq("id", data.id);
        await db.from("listings").update({ status: "draft" }).eq("creator_id", data.id);
        break;
      case "ban_creator":
        await db.from("creators").update({ banned: true }).eq("id", data.id);
        break;
      case "unban_creator":
        await db.from("creators").update({ banned: false }).eq("id", data.id);
        break;
      case "pause_listing":
        await db.from("listings").update({ status: "paused" }).eq("id", data.id);
        break;
      case "activate_listing":
        await db.from("listings").update({ status: "active" }).eq("id", data.id);
        break;
      case "disable_destination":
        await db.from("ownerships").update({ destination_disabled: true }).eq("id", data.id);
        break;
      case "enable_destination":
        await db.from("ownerships").update({ destination_disabled: false }).eq("id", data.id);
        break;
    }
    return { ok: true } as const;
  });

/* ------------------------------------------------------------- transactions */

export type AdminTransaction = {
  paymentId: string;
  buyer: string;
  buyerEmail: string;
  creator: string;
  slug: string;
  amountCents: number;
  paymentStatus: string;
  ownershipStatus: string | null;
  placementStatus: string | null;
  activationDeadline: string | null;
  firstVerifiedAt: string | null;
  verificationStatus: string | null;
  finalVerification: string | null;
  finalVerifiedAt: string | null;
  mismatchPendingSince: string | null;
  mismatchReason: string | null;
  verificationError: string | null;
  payoutStatus: string | null;
  releaseAt: string | null;
  stripeTransferId: string | null;
  refundStatus: string;
  refundReason: string | null;
  refundError: string | null;
  stripeRefundId: string | null;
  adminReview: boolean;
  createdAt: string;
  bucket: "attention" | "awaiting" | "active" | "pending_payout" | "refunded" | "failed";
};

/** One row per purchase, stitched from payments + ownerships + payouts. */
export const getAdminTransactions = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => tokenIn.parse(input))
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./authz.server");
    const { admin } = await import("./db.server");
    const gate = await requireAdmin(data.token);
    if (!gate.ok) return { error: gate.error } as const;
    const db = admin();

    const { data: payments } = await db
      .from("payments")
      .select(
        "id, listing_id, company_name, email, amount_cents, status, refund_status, refund_reason, refund_error, stripe_refund_id, admin_review_required, created_at",
      )
      .in("status", ["paid", "applied", "stale", "refunded"])
      .order("created_at", { ascending: false })
      .limit(150);

    const ids = (payments ?? []).map((p) => p.id);
    const listingIds = [...new Set((payments ?? []).map((p) => p.listing_id))];

    const [ownerships, payouts, listings] = await Promise.all([
      ids.length
        ? db
            .from("ownerships")
            .select(
              "payment_id, status, placement_status, activation_deadline, first_verified_at, bio_verification_status, last_verification_error, final_verification_status, final_verified_at, mismatch_pending_since, mismatch_reason",
            )
            .in("payment_id", ids)
        : { data: [] as never[] },
      ids.length
        ? db
            .from("payouts")
            .select("payment_id, status, payout_status, release_at, stripe_transfer_id, last_error")
            .in("payment_id", ids)
        : { data: [] as never[] },
      listingIds.length
        ? db.from("listings").select("id, slug, creator_id").in("id", listingIds)
        : { data: [] as never[] },
    ]);

    const creatorIds = [...new Set((listings.data ?? []).map((l) => l.creator_id))];
    const { data: creators } = creatorIds.length
      ? await db.from("creators").select("id, username, x_username").in("id", creatorIds)
      : { data: [] as never[] };

    const oMap = new Map((ownerships.data ?? []).map((o) => [o.payment_id, o]));
    const pMap = new Map((payouts.data ?? []).map((p) => [p.payment_id, p]));
    const lMap = new Map((listings.data ?? []).map((l) => [l.id, l]));
    const cMap = new Map((creators ?? []).map((c) => [c.id, c]));

    const rows: AdminTransaction[] = (payments ?? []).map((p) => {
      const o = oMap.get(p.id) as Record<string, string | null> | undefined;
      const po = pMap.get(p.id) as Record<string, string | null> | undefined;
      const l = lMap.get(p.listing_id) as { slug: string; creator_id: string } | undefined;
      const c = l
        ? (cMap.get(l.creator_id) as { username: string; x_username: string | null } | undefined)
        : undefined;

      const refundStatus = String(p.refund_status ?? "none");
      const placement = (o?.["placement_status"] as string | null) ?? null;
      const payoutStatus = (po?.["payout_status"] as string | null) ?? null;

      let bucket: AdminTransaction["bucket"] = "active";
      if (
        p.admin_review_required ||
        refundStatus === "failed" ||
        po?.["status"] === ("failed" as unknown) ||
        placement === "non_compliant" ||
        (o?.["final_verification_status"] as string | null) === "unresolved"
      )
        bucket = "attention";
      else if (refundStatus === "refunded" || refundStatus === "pending") bucket = "refunded";
      else if (placement === "activation_failed" || placement === "superseded_before_activation")
        bucket = "failed";
      else if (placement === "awaiting_activation") bucket = "awaiting";
      else if (payoutStatus === "pending") bucket = "pending_payout";

      return {
        paymentId: p.id,
        buyer: p.company_name,
        buyerEmail: p.email,
        creator: c?.x_username ?? c?.username ?? l?.slug ?? "—",
        slug: l?.slug ?? "",
        amountCents: p.amount_cents,
        paymentStatus: String(p.status),
        ownershipStatus: (o?.["status"] as string | null) ?? null,
        placementStatus: placement,
        activationDeadline: (o?.["activation_deadline"] as string | null) ?? null,
        firstVerifiedAt: (o?.["first_verified_at"] as string | null) ?? null,
        verificationStatus: (o?.["bio_verification_status"] as string | null) ?? null,
        finalVerification: (o?.["final_verification_status"] as string | null) ?? null,
        finalVerifiedAt: (o?.["final_verified_at"] as string | null) ?? null,
        mismatchPendingSince: (o?.["mismatch_pending_since"] as string | null) ?? null,
        mismatchReason: (o?.["mismatch_reason"] as string | null) ?? null,
        verificationError:
          (o?.["last_verification_error"] as string | null) ??
          (po?.["last_error"] as string | null) ??
          null,
        payoutStatus: payoutStatus ?? (po?.["status"] as string | null) ?? null,
        releaseAt: (po?.["release_at"] as string | null) ?? null,
        stripeTransferId: (po?.["stripe_transfer_id"] as string | null) ?? null,
        refundStatus,
        refundReason: (p.refund_reason as string | null) ?? null,
        refundError: (p.refund_error as string | null) ?? null,
        stripeRefundId: (p.stripe_refund_id as string | null) ?? null,
        adminReview: Boolean(p.admin_review_required),
        createdAt: p.created_at,
        bucket,
      };
    });

    return { rows } as const;
  });

/**
 * Recovery actions. They call the SAME idempotent helpers as the cron jobs, so
 * clicking twice can never create a second refund or transfer.
 */
export const adminTransactionAction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    tokenIn
      .extend({
        action: z.enum(["retry_refund", "retry_verification", "retry_payout", "clear_review"]),
        paymentId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./authz.server");
    const { admin } = await import("./db.server");
    const gate = await requireAdmin(data.token);
    if (!gate.ok) return { error: gate.error } as const;
    const db = admin();

    if (data.action === "clear_review") {
      await db
        .from("payments")
        .update({ admin_review_required: false, admin_review_reason: null })
        .eq("id", data.paymentId);
      return { ok: true, result: "review_cleared" } as const;
    }

    if (data.action === "retry_refund") {
      const { data: payment } = await db
        .from("payments")
        .select("id, refund_reason, needs_refund_reason, admin_review_required")
        .eq("id", data.paymentId)
        .maybeSingle();
      if (!payment) return { error: "payment_not_found" } as const;
      const { refundPayment, normalizeReason } = await import("./refunds.server");
      const reason = normalizeReason(
        (payment.refund_reason as string | null) ?? (payment.needs_refund_reason as string | null),
      );
      // An admin retry is an explicit decision, so it may proceed even when the
      // payout already went out — still fully idempotent per payment.
      const result = await refundPayment(data.paymentId, reason, {
        allowAfterPayout: Boolean(payment.admin_review_required),
      });
      return { ok: true, result: result.status } as const;
    }

    if (data.action === "retry_verification") {
      const { data: ownership } = await db
        .from("ownerships")
        .select(
          "id, listing_id, payment_id, bio_message, destination_url, placement_format, first_verified_at",
        )
        .eq("payment_id", data.paymentId)
        .maybeSingle();
      if (!ownership) return { error: "ownership_not_found" } as const;
      const { data: listing } = await db
        .from("listings")
        .select("creator_id")
        .eq("id", ownership.listing_id)
        .maybeSingle();
      const { data: creator } = listing
        ? await db
            .from("creators")
            .select("id, username, x_user_id")
            .eq("id", listing.creator_id)
            .maybeSingle()
        : { data: null };
      if (!creator) return { error: "creator_not_found" } as const;
      const { checkPlacement } = await import("./verification.server");
      const result = await checkPlacement({
        creatorId: creator.id,
        username: creator.username,
        xUserId: creator.x_user_id ? String(creator.x_user_id) : null,
        message: (ownership.bio_message as string | null) ?? null,
        url: (ownership.destination_url as string | null) ?? null,
        placementFormat: (ownership.placement_format as string | null) ?? null,
      });
      if (result.outcome === "match" && !ownership.first_verified_at) {
        const { markActivated } = await import("./activation.server");
        await markActivated(ownership.id, ownership.payment_id, new Date().toISOString());
      }
      return { ok: true, result: result.outcome } as const;
    }

    const { data: payout } = await db
      .from("payouts")
      .select("id")
      .eq("payment_id", data.paymentId)
      .maybeSingle();
    if (!payout) return { error: "payout_not_found" } as const;
    const { releaseOne } = await import("./payouts.server");
    const result = await releaseOne(payout.id);
    return { ok: true, result } as const;
  });
