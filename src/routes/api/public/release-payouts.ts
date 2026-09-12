import { createFileRoute } from "@tanstack/react-router";

async function socialBidPayoutCronSecret(): Promise<string | null> {
  const configured = process.env["PAYOUT_CRON_SECRET_SOCIAL_BID"]?.trim();
  if (configured) return configured;

  try {
    const { admin } = await import("@/lib/db.server");
    const { data, error } = await admin().rpc("get_social_bid_payout_cron_secret");
    if (error) throw new Error(error.message);
    const vaultSecret = typeof data === "string" ? data.trim() : "";
    return vaultSecret || null;
  } catch (error) {
    console.error("Social Bid payout cron Vault configuration lookup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Releases held creator payouts whose hold window has elapsed.
 * Call on a schedule (e.g. hourly) with:
 *   Authorization: Bearer $PAYOUT_CRON_SECRET_SOCIAL_BID
 */
export const Route = createFileRoute("/api/public/release-payouts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = await socialBidPayoutCronSecret();
        if (!secret) return new Response("Not configured", { status: 503 });

        const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const a = new TextEncoder().encode(provided);
        const b = new TextEncoder().encode(secret);
        let diff = a.length ^ b.length;
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
          diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
        }
        if (diff !== 0) return new Response("Unauthorized", { status: 401 });

        // Keep legacy-record maintenance separate from the website-only payout
        // flow, then release everything that is still eligible.
        const { runActivationSweep } = await import("@/lib/activation.server");
        const activation = await runActivationSweep();
        const { runPlacementSweep, resolveUnresolvedFinalVerifications } =
          await import("@/lib/verification.server");
        const verification = await runPlacementSweep();
        // Settle transition verifications the X API couldn't answer earlier.
        const transitions = await resolveUnresolvedFinalVerifications();
        const { releaseDuePayouts } = await import("@/lib/payouts.server");
        const summary = await releaseDuePayouts();
        const { processRefundQueue } = await import("@/lib/refunds.server");
        const refunds = await processRefundQueue();
        // Nudge creators who have money waiting but no payout account yet.
        const { runPayoutSetupReminderSweep } = await import("@/lib/payout-reminders.server");
        const payoutReminders = await runPayoutSetupReminderSweep();
        // Nudge creators who connected X but never made their profile live.
        const { runListingActivationReminderSweep } =
          await import("@/lib/listing-reminders.server");
        const listingReminders = await runListingActivationReminderSweep();
        return Response.json({
          activation,
          verification,
          transitions,
          payouts: summary,
          refunds,
          payoutReminders,
          listingReminders,
        });
      },
    },
  },
});
