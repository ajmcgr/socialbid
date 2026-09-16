import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const authInput = z.object({ token: z.string().max(5000).optional().nullable() });

export const requestBuyerRecovery = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    authInput.extend({ email: z.string().email().max(160) }).parse(input),
  )
  .handler(async ({ data }) => {
    const generic = {
      ok: true,
      message:
        "If eligible sponsorships are associated with that email, we've sent verification instructions.",
    } as const;
    try {
      const { admin, baseUrl } = await import("./db.server");
      const { resolveCanonicalAccount } = await import("./account.server");
      const { generateClaimToken, hashClaimToken } = await import("./account-claims.server");
      const { sendBuyerRecoveryEmail } = await import("./email.server");
      const db = admin();
      const account = await resolveCanonicalAccount(db, data.token);
      if (!account) return generic;

      const email = data.email.trim().toLowerCase();
      const { data: buyers } = await db
        .from("buyers")
        .select("id, email, user_id, company_name")
        .ilike("email", email);
      for (const buyer of buyers ?? []) {
        if (buyer.user_id === account.userId) continue;
        const { data: payments, error: paymentLookupError } = await db
          .from("payments")
          .select("status, initiated_by_user_id")
          .eq("buyer_id", buyer.id)
          .eq("status", "applied");
        if (paymentLookupError || !payments?.length) continue;
        // A differently owned buyer can only be recovered when every applied
        // sponsorship predates canonical payment principals. The verified
        // checkout email is then the one-time ownership proof. Any modern
        // principal belonging to another account makes transfer ineligible.
        const hasConflictingPrincipal = payments.some(
          (payment) =>
            payment.initiated_by_user_id && payment.initiated_by_user_id !== account.userId,
        );
        if (hasConflictingPrincipal) continue;
        const { count: recent } = await db
          .from("social_bid_buyer_recovery_requests")
          .select("id", { count: "exact", head: true })
          .eq("user_id", account.userId)
          .eq("buyer_id", buyer.id)
          .gt("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
        if (recent) continue;
        const rawToken = generateClaimToken();
        const { error } = await db.from("social_bid_buyer_recovery_requests").insert({
          user_id: account.userId,
          buyer_id: buyer.id,
          token_hash: await hashClaimToken(rawToken),
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        if (error) continue;
        await sendBuyerRecoveryEmail({
          to: String(buyer.email),
          company: String(buyer.company_name || "your sponsor identity"),
          actionLink: `${baseUrl()}/api/public/buyer-recovery?token=${encodeURIComponent(rawToken)}`,
          idempotencyKey: `buyer-recovery:${account.userId}:${buyer.id}:${await hashClaimToken(rawToken)}`,
        });
      }
    } catch (error) {
      console.error("buyer recovery request failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
    return generic;
  });

export const completeBuyerRecovery = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => authInput.parse(input))
  .handler(async ({ data }) => {
    const { admin } = await import("./db.server");
    const { resolveCanonicalAccount } = await import("./account.server");
    const { consumeHistoricalBuyerClaim } = await import("./account-claims.server");
    const db = admin();
    const account = await resolveCanonicalAccount(db, data.token);
    if (!account) return { error: "Sign in to recover sponsorships." } as const;
    const buyerId = await consumeHistoricalBuyerClaim(db, account.userId);
    return buyerId ? ({ ok: true } as const) : ({ ok: false } as const);
  });
