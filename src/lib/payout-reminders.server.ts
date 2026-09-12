import { admin } from "./db.server";
import { sendPayoutSetupReminderEmail } from "./email.server";
import { creatorEmail } from "./notify.server";

/** Days between reminders, and the number of reminders we ever send per creator. */
const REMINDER_INTERVAL_DAYS = 3;
const MAX_REMINDERS = 8;
/** Bound the work per cron run. */
const MAX_CREATORS_PER_RUN = 25;

export type PayoutReminderSummary = {
  candidates: number;
  sent: number;
  skipped: number;
};

/**
 * Emails creators who have money waiting but no connected Stripe account.
 * Idempotent and rate limited per creator through payout_setup_reminders.
 */
export async function runPayoutSetupReminderSweep(): Promise<PayoutReminderSummary> {
  const db = admin();
  const summary: PayoutReminderSummary = { candidates: 0, sent: 0, skipped: 0 };

  const { data: payouts, error } = await db
    .from("payouts")
    .select("creator_id, amount_cents, status")
    .in("status", ["pending", "blocked"])
    .limit(500);
  if (error || !payouts?.length) return summary;

  const owed = new Map<string, number>();
  for (const payout of payouts) {
    const creatorId = payout.creator_id as string | null;
    if (!creatorId) continue;
    owed.set(creatorId, (owed.get(creatorId) ?? 0) + (payout.amount_cents ?? 0));
  }
  if (owed.size === 0) return summary;

  const { data: creators } = await db
    .from("creators")
    .select("id, banned, stripe_account_id")
    .in("id", [...owed.keys()]);

  const pendingSetup = (creators ?? []).filter(
    (creator) => !creator.banned && !creator.stripe_account_id,
  );
  summary.candidates = pendingSetup.length;
  if (pendingSetup.length === 0) return summary;

  const { data: reminders } = await db
    .from("payout_setup_reminders")
    .select("creator_id, last_sent_at, sent_count")
    .in(
      "creator_id",
      pendingSetup.map((creator) => creator.id),
    );
  const reminderByCreator = new Map(
    (reminders ?? []).map((row) => [row.creator_id as string, row]),
  );

  const now = Date.now();
  const cutoff = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  let processed = 0;

  for (const creator of pendingSetup) {
    if (processed >= MAX_CREATORS_PER_RUN) break;
    const amountCents = owed.get(creator.id) ?? 0;
    if (amountCents < 100) continue;

    const reminder = reminderByCreator.get(creator.id);
    const sentCount = (reminder?.sent_count as number | undefined) ?? 0;
    const lastSentAt = reminder?.last_sent_at ? Date.parse(reminder.last_sent_at as string) : 0;
    if (sentCount >= MAX_REMINDERS || now - lastSentAt < cutoff) {
      summary.skipped += 1;
      continue;
    }

    const to = await creatorEmail(creator.id);
    if (!to) {
      summary.skipped += 1;
      continue;
    }

    processed += 1;
    const period = Math.floor(now / cutoff);
    const result = await sendPayoutSetupReminderEmail({
      to,
      amountCents,
      idempotencyKey: `payout-setup-${creator.id}-${period}`,
    });
    if (!result.sent) {
      summary.skipped += 1;
      continue;
    }

    await db.from("payout_setup_reminders").upsert(
      {
        creator_id: creator.id,
        last_sent_at: new Date(now).toISOString(),
        sent_count: sentCount + 1,
      },
      { onConflict: "creator_id" },
    );
    summary.sent += 1;
  }

  return summary;
}
