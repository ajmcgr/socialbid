import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const creatorSessionIn = z.object({});
const PAYOUT_HOLD_DAYS = 7;

export type PayoutStatus = {
  configured: boolean;
  connected: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  holdDays: number;
  feePercentage: number;
  pendingCents: number;
  paidCents: number;
  items: {
    id: string;
    amountCents: number;
    grossCents: number;
    status: string;
    holdUntil: string;
    releasedAt: string | null;
    note: string | null;
  }[];
};

async function creatorFromSession() {
  const [{ admin }, { resolveCreatorSession }] = await Promise.all([
    import("./db.server"),
    import("./creator-session.server"),
  ]);
  const db = admin();
  const session = await resolveCreatorSession(db);
  if (!session) return { db, creator: null };
  const { data } = await db
    .from("creators")
    .select(
      "id, username, banned, stripe_account_id, stripe_payouts_enabled, stripe_details_submitted",
    )
    .eq("user_id", session.userId)
    .maybeSingle();
  return { db, creator: data };
}

export const getPayoutStatus = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }): Promise<PayoutStatus | null> => {
    const { db, creator } = await creatorFromSession();
    if (!creator) return null;

    const { data: rows } = await db
      .from("payouts")
      .select(
        "id, amount_cents, gross_cents, status, hold_until, released_at, last_error, fee_percentage",
      )
      .eq("creator_id", creator.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const items = (rows ?? []).map((r) => ({
      id: r.id as string,
      amountCents: Number(r.amount_cents),
      grossCents: Number(r.gross_cents),
      status: String(r.status),
      holdUntil: String(r.hold_until),
      releasedAt: (r.released_at as string | null) ?? null,
      note: (r.last_error as string | null) ?? null,
    }));

    return {
      configured: Boolean(process.env["STRIPE_SECRET_KEY"]),
      connected: Boolean(creator.stripe_account_id),
      payoutsEnabled: Boolean(creator.stripe_payouts_enabled),
      detailsSubmitted: Boolean(creator.stripe_details_submitted),
      holdDays: PAYOUT_HOLD_DAYS,
      feePercentage: Number(rows?.[0]?.fee_percentage ?? 20),
      pendingCents: items
        .filter((i) => i.status === "pending" || i.status === "blocked")
        .reduce((sum, i) => sum + i.amountCents, 0),
      paidCents: items
        .filter((i) => i.status === "paid")
        .reduce((sum, i) => sum + i.amountCents, 0),
      items,
    };
  });

/** Creates (or reuses) the creator's connected account and returns an onboarding URL. */
export const startPayoutOnboarding = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }) => {
    const { db, creator } = await creatorFromSession();
    if (!creator || creator.banned) return { error: "Session expired. Connect X again." } as const;
    if (!process.env["STRIPE_SECRET_KEY"])
      return { error: "Payouts aren't configured yet." } as const;

    const { baseUrl } = await import("./db.server");
    const { createConnectAccount, createAccountLink } = await import("./stripe.server");

    try {
      let accountId = creator.stripe_account_id as string | null;
      if (!accountId) {
        const account = (await createConnectAccount({
          username: creator.username,
          email: null,
        })) as Record<string, unknown>;
        accountId = String(account["id"]);
        await db.from("creators").update({ stripe_account_id: accountId }).eq("id", creator.id);
      }
      const link = (await createAccountLink(accountId, baseUrl())) as Record<string, unknown>;
      return { url: String(link["url"]) } as const;
    } catch (e) {
      console.error("connect onboarding failed", e);
      return { error: "Stripe couldn't start onboarding. Try again." } as const;
    }
  });

/** Refreshes the cached Stripe onboarding state after the creator returns. */
export const refreshPayoutAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }) => {
    const { db, creator } = await creatorFromSession();
    if (!creator?.stripe_account_id) return { ok: false } as const;
    const { retrieveAccount } = await import("./stripe.server");
    try {
      const account = (await retrieveAccount(creator.stripe_account_id)) as Record<string, unknown>;
      await db
        .from("creators")
        .update({
          stripe_payouts_enabled: account["payouts_enabled"] === true,
          stripe_details_submitted: account["details_submitted"] === true,
          ...(account["payouts_enabled"] === true
            ? { stripe_onboarded_at: new Date().toISOString() }
            : {}),
        })
        .eq("id", creator.id);
      return { ok: true } as const;
    } catch {
      return { ok: false } as const;
    }
  });

/** Opens the creator's Stripe Express dashboard. */
export const payoutDashboardLink = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }) => {
    const { creator } = await creatorFromSession();
    if (!creator?.stripe_account_id) return { error: "No payout account yet." } as const;
    const { createLoginLink } = await import("./stripe.server");
    try {
      const link = (await createLoginLink(creator.stripe_account_id)) as Record<string, unknown>;
      return { url: String(link["url"]) } as const;
    } catch {
      return { error: "Finish onboarding first." } as const;
    }
  });
