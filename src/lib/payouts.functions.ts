import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const creatorSessionIn = z.object({});
const payoutOnboardingIn = z.object({ country: z.string().optional() });
const payoutResetIn = z.object({ confirmation: z.literal("START_OVER") });
const PAYOUT_HOLD_DAYS = 7;

type ResetStatus = {
  eligible: boolean;
  reason: string | null;
  contactSupport: boolean;
};

type CreatorPayoutRow = {
  id: string;
  username: string;
  banned: boolean;
  stripe_account_id: string | null;
  stripe_payouts_enabled: boolean;
  stripe_details_submitted: boolean;
  stripe_connect_generation: number;
  stripe_reset_in_progress: boolean;
};

export type PayoutStatus = {
  configured: boolean;
  connected: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  accountCountry: string | null;
  reset: ResetStatus | null;
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

function normalizeCountry(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{2}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : null;
}

function isDeletedAccount(account: Record<string, unknown>): boolean {
  return account["deleted"] === true;
}

function needsSupport(reason: string | null): boolean {
  return [
    "financial_history",
    "stripe_balance",
    "stripe_payout_history",
    "stripe_account_not_deletable",
    "stripe_account_ownership",
  ].includes(reason ?? "");
}

function resetStatus(eligible: boolean, reason: string | null): ResetStatus {
  return { eligible, reason, contactSupport: !eligible && needsSupport(reason) };
}

async function creatorFromSession() {
  const [{ admin }, { resolveCreatorSession }] = await Promise.all([
    import("./db.server"),
    import("./creator-session.server"),
  ]);
  const db = admin();
  const session = await resolveCreatorSession(db);
  if (!session) return { db, creator: null };
  const { data, error } = await db
    .from("creators")
    .select(
      "id, username, banned, stripe_account_id, stripe_payouts_enabled, stripe_details_submitted, stripe_connect_generation, stripe_reset_in_progress",
    )
    .eq("user_id", session.userId)
    .maybeSingle();
  if (error) throw new Error(`creator payout lookup failed: ${error.message}`);
  return { db, creator: data as CreatorPayoutRow | null };
}

async function inspectStripeReset(
  account: Record<string, unknown>,
  creator: CreatorPayoutRow,
): Promise<ResetStatus> {
  if (isDeletedAccount(account)) return resetStatus(false, "stripe_account_deleted");

  const metadata = (account["metadata"] as Record<string, unknown> | null) ?? {};
  const explicitOwner = metadata["socialbid_creator_id"];
  const legacyUsername = metadata["buymybio_username"];
  if (
    (typeof explicitOwner === "string" && explicitOwner !== creator.id) ||
    (explicitOwner == null &&
      typeof legacyUsername === "string" &&
      legacyUsername.toLowerCase() !== creator.username.toLowerCase())
  ) {
    return resetStatus(false, "stripe_account_ownership");
  }
  if (account["details_submitted"] === true) return resetStatus(false, "onboarding_complete");

  const controller = account["controller"] as
    { losses?: { payments?: string | null } | null } | undefined;
  const controllerLosses = controller?.losses?.payments;
  const platformControlled = account["type"] === "express" || account["type"] === "custom";
  if (!platformControlled || (controllerLosses && controllerLosses !== "application")) {
    return resetStatus(false, "stripe_account_not_deletable");
  }

  const { retrieveConnectBalance, listConnectPayouts } = await import("./stripe.server");
  const [balance, payouts] = (await Promise.all([
    retrieveConnectBalance(creator.stripe_account_id!),
    listConnectPayouts(creator.stripe_account_id!),
  ])) as [Record<string, unknown>, Record<string, unknown>];
  const balanceBuckets = [
    balance["available"],
    balance["pending"],
    balance["connect_reserved"],
    balance["instant_available"],
    (balance["refund_and_dispute_prefunding"] as Record<string, unknown> | undefined)?.[
      "available"
    ],
    (balance["refund_and_dispute_prefunding"] as Record<string, unknown> | undefined)?.["pending"],
  ];
  const hasBalance = balanceBuckets.some(
    (bucket) =>
      Array.isArray(bucket) &&
      bucket.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          Number((entry as Record<string, unknown>)["amount"] ?? 0) !== 0,
      ),
  );
  if (hasBalance) return resetStatus(false, "stripe_balance");
  if (Array.isArray(payouts["data"]) && payouts["data"].length > 0) {
    return resetStatus(false, "stripe_payout_history");
  }
  return resetStatus(true, null);
}

async function inspectReset(
  db: ReturnType<(typeof import("./db.server"))["admin"]>,
  creator: CreatorPayoutRow,
  account: Record<string, unknown>,
): Promise<ResetStatus> {
  const { data, error } = await db.rpc("inspect_social_bid_stripe_connect_reset", {
    p_creator_id: creator.id,
    p_stripe_account_id: creator.stripe_account_id,
  });
  if (error) throw new Error(error.message);
  const result = (data ?? {}) as { eligible?: boolean; reason?: string | null };
  if (!result.eligible) return resetStatus(false, result.reason ?? "financial_history");
  return inspectStripeReset(account, creator);
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

    let accountCountry: string | null = null;
    let reset: ResetStatus | null = null;
    if (creator.stripe_account_id && process.env["STRIPE_SECRET_KEY"]) {
      try {
        const { retrieveAccount } = await import("./stripe.server");
        const account = (await retrieveAccount(creator.stripe_account_id)) as Record<
          string,
          unknown
        >;
        accountCountry = normalizeCountry(account["country"]);
        reset = creator.stripe_reset_in_progress
          ? resetStatus(false, "reset_in_progress")
          : await inspectReset(db, creator, account);
      } catch (error) {
        console.error("connect status inspection failed", {
          error: error instanceof Error ? error.message : "unknown_error",
        });
      }
    }

    return {
      configured: Boolean(process.env["STRIPE_SECRET_KEY"]),
      connected: Boolean(creator.stripe_account_id),
      payoutsEnabled: Boolean(creator.stripe_payouts_enabled),
      detailsSubmitted: Boolean(creator.stripe_details_submitted),
      accountCountry,
      reset,
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

/** Lists the authoritative Stripe Country Specs without creating an account. */
export const getPayoutCountries = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }) => {
    const { creator } = await creatorFromSession();
    if (!creator) return { error: "Session expired. Connect X again." } as const;
    if (!process.env["STRIPE_SECRET_KEY"])
      return { error: "Payouts aren't configured yet." } as const;
    try {
      const { listConnectCountries } = await import("./stripe.server");
      const specs = (await listConnectCountries()) as Record<string, unknown>;
      const countries = Array.isArray(specs["data"])
        ? specs["data"]
            .map((spec) =>
              typeof spec === "object" && spec !== null
                ? normalizeCountry((spec as Record<string, unknown>)["id"])
                : null,
            )
            .filter((country): country is string => Boolean(country))
            .sort()
        : [];
      if (!countries.length) return { error: "Stripe countries are unavailable." } as const;
      return { countries } as const;
    } catch (error) {
      console.error("connect countries lookup failed", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return { error: "Stripe countries are unavailable." } as const;
    }
  });

/** Creates (or reuses) the creator's connected account and returns an onboarding URL. */
export const startPayoutOnboarding = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => payoutOnboardingIn.parse(input))
  .handler(async ({ data }) => {
    const { db, creator } = await creatorFromSession();
    if (!creator || creator.banned) return { error: "Session expired. Connect X again." } as const;
    if (!process.env["STRIPE_SECRET_KEY"])
      return { error: "Payouts aren't configured yet." } as const;
    if (creator.stripe_reset_in_progress)
      return { error: "Payout setup is already being restarted. Try again shortly." } as const;

    const { baseUrl } = await import("./db.server");
    const {
      createConnectAccount,
      createAccountLink,
      retrieveAccount,
      retrieveCountrySpec,
      deleteConnectAccount,
    } = await import("./stripe.server");

    try {
      let accountId = creator.stripe_account_id;
      if (!accountId) {
        const country = normalizeCountry(data.country);
        if (!country) return { error: "Choose where you're based before continuing." } as const;
        const spec = (await retrieveCountrySpec(country)) as Record<string, unknown>;
        if (normalizeCountry(spec["id"]) !== country) {
          return { error: "That country isn't supported by Stripe." } as const;
        }

        const account = (await createConnectAccount({
          country,
          creatorId: creator.id,
          username: creator.username,
          email: null,
          generation: creator.stripe_connect_generation,
        })) as Record<string, unknown>;
        accountId = String(account["id"] ?? "");
        if (!accountId || normalizeCountry(account["country"]) !== country) {
          if (accountId) {
            try {
              await deleteConnectAccount(accountId);
            } catch (cleanupError) {
              console.error("connect country mismatch cleanup failed", {
                error: cleanupError instanceof Error ? cleanupError.message : "unknown_error",
              });
            }
          }
          throw new Error("connect_account_country_mismatch");
        }

        const { data: associated, error: updateError } = await db
          .from("creators")
          .update({
            stripe_account_id: accountId,
            stripe_payouts_enabled: account["payouts_enabled"] === true,
            stripe_details_submitted: account["details_submitted"] === true,
          })
          .eq("id", creator.id)
          .eq("stripe_connect_generation", creator.stripe_connect_generation)
          .eq("stripe_reset_in_progress", false)
          .is("stripe_account_id", null)
          .select("stripe_account_id")
          .maybeSingle();
        if (updateError)
          throw new Error(`connect account association failed: ${updateError.message}`);
        if (associated?.stripe_account_id !== accountId) {
          const { data: current, error: currentError } = await db
            .from("creators")
            .select("stripe_account_id")
            .eq("id", creator.id)
            .maybeSingle();
          if (currentError || current?.stripe_account_id !== accountId) {
            throw new Error(currentError?.message ?? "connect_account_association_failed");
          }
        }
        const { error: auditError } = await db.rpc("record_social_bid_stripe_connect_replacement", {
          p_creator_id: creator.id,
          p_new_stripe_account_id: accountId,
        });
        if (auditError) console.error("connect replacement audit failed", auditError.message);
      } else {
        const account = (await retrieveAccount(accountId)) as Record<string, unknown>;
        if (isDeletedAccount(account)) throw new Error("connect_account_unavailable");
      }

      const link = (await createAccountLink(accountId, baseUrl())) as Record<string, unknown>;
      return { url: String(link["url"]) } as const;
    } catch (e) {
      console.error("connect onboarding failed", {
        error: e instanceof Error ? e.message : "unknown_error",
      });
      return { error: "Stripe couldn't start onboarding. Try again." } as const;
    }
  });

/** Safely removes an unused, incomplete connected account so country can be selected again. */
export const resetPayoutAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => payoutResetIn.parse(input))
  .handler(async ({ data }) => {
    const { db, creator } = await creatorFromSession();
    if (!creator) return { error: "Session expired. Connect X again." } as const;
    if (!creator.stripe_account_id) return { reset: true, alreadyReset: true } as const;

    const { data: claimData, error: claimError } = await db.rpc(
      "claim_social_bid_stripe_connect_reset",
      { p_creator_id: creator.id, p_stripe_account_id: creator.stripe_account_id },
    );
    if (claimError) return { error: "Your payout setup couldn't be restarted." } as const;
    const claim = (claimData ?? {}) as {
      claimed?: boolean;
      reason?: string;
      resetId?: string;
      recoverable?: boolean;
    };
    if (!claim.claimed && !(claim.reason === "reset_in_progress" && claim.recoverable)) {
      return {
        error: "This Stripe account can't be safely restarted. Contact support.",
        contactSupport: needsSupport(claim.reason ?? null),
      } as const;
    }
    if (!claim.resetId) return { error: "Your payout setup couldn't be restarted." } as const;

    const { retrieveAccount, deleteConnectAccount } = await import("./stripe.server");
    let deletionAttempted = false;
    const release = async (failureCode: string) => {
      const { error } = await db.rpc("release_social_bid_stripe_connect_reset", {
        p_creator_id: creator.id,
        p_stripe_account_id: creator.stripe_account_id,
        p_reset_id: claim.resetId,
        p_failure_code: failureCode,
      });
      if (error) console.error("connect reset release failed", error.message);
    };
    const complete = async () => {
      const { data: completed, error } = await db.rpc("complete_social_bid_stripe_connect_reset", {
        p_creator_id: creator.id,
        p_stripe_account_id: creator.stripe_account_id,
        p_reset_id: claim.resetId,
      });
      if (error || completed !== true) throw new Error(error?.message ?? "reset_completion_failed");
    };

    try {
      const account = (await retrieveAccount(creator.stripe_account_id)) as Record<string, unknown>;
      if (isDeletedAccount(account)) {
        await complete();
        return { reset: true, alreadyDeleted: true } as const;
      }
      const eligibility = await inspectStripeReset(account, creator);
      if (!eligibility.eligible) {
        await release(eligibility.reason ?? "unsafe");
        return {
          error: "This Stripe account can't be safely restarted. Contact support.",
          contactSupport: eligibility.contactSupport,
        } as const;
      }

      deletionAttempted = true;
      const deleted = (await deleteConnectAccount(creator.stripe_account_id)) as Record<
        string,
        unknown
      >;
      if (deleted["deleted"] !== true) throw new Error("stripe_delete_not_confirmed");
      await complete();
      return { reset: true } as const;
    } catch (error) {
      const failureCode =
        error && typeof error === "object" && "code" in error && typeof error.code === "string"
          ? error.code
          : "stripe_delete_failed";
      console.error("connect reset failed", {
        error: error instanceof Error ? error.message : "unknown_error",
        failureCode,
      });
      if (deletionAttempted) {
        try {
          const account = (await retrieveAccount(creator.stripe_account_id)) as Record<
            string,
            unknown
          >;
          if (isDeletedAccount(account)) {
            await complete();
            return { reset: true, recovered: true } as const;
          }
        } catch (recoveryError) {
          console.error("connect reset recovery failed", {
            error: recoveryError instanceof Error ? recoveryError.message : "unknown_error",
          });
        }
      }
      await release(failureCode);
      return { error: "Your payout setup wasn't changed. Please try again." } as const;
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
