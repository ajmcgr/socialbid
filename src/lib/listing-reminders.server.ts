import { admin } from "./db.server";
import { sendListingActivationReminderEmail } from "./email.server";
import { creatorEmail } from "./notify.server";

/** Days between reminders, and the number of reminders we ever send per creator. */
const REMINDER_INTERVAL_DAYS = 2;
const MAX_REMINDERS = 4;
/** Bound the work per cron run. */
const MAX_CREATORS_PER_RUN = 25;

export type ListingReminderSummary = {
  candidates: number;
  sent: number;
  skipped: number;
};

/**
 * Nudges creators who connected X but never clicked "Add my profile", so their
 * listing is still a draft and invisible to sponsors. Rate limited per creator
 * through listing_activation_reminders.
 */
export async function runListingActivationReminderSweep(): Promise<ListingReminderSummary> {
  const db = admin();
  const summary: ListingReminderSummary = { candidates: 0, sent: 0, skipped: 0 };

  const { data: drafts, error } = await db
    .from("listings")
    .select("creator_id, starting_price_cents, status")
    .eq("status", "draft")
    .limit(500);
  if (error || !drafts?.length) return summary;

  const priceByCreator = new Map<string, number>();
  for (const listing of drafts) {
    const creatorId = listing.creator_id as string | null;
    if (creatorId) priceByCreator.set(creatorId, listing.starting_price_cents ?? 0);
  }

  const { data: creators } = await db
    .from("creators")
    .select("id, display_name, banned, x_account_verified")
    .in("id", [...priceByCreator.keys()]);

  const eligible = (creators ?? []).filter(
    (creator) => !creator.banned && creator.x_account_verified,
  );
  summary.candidates = eligible.length;
  if (eligible.length === 0) return summary;

  const { data: reminders } = await db
    .from("listing_activation_reminders")
    .select("creator_id, last_sent_at, sent_count")
    .in(
      "creator_id",
      eligible.map((creator) => creator.id),
    );
  const reminderByCreator = new Map(
    (reminders ?? []).map((row) => [row.creator_id as string, row]),
  );

  const now = Date.now();
  const cutoff = REMINDER_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
  let processed = 0;

  for (const creator of eligible) {
    if (processed >= MAX_CREATORS_PER_RUN) break;

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
    const result = await sendListingActivationReminderEmail({
      to,
      displayName: String(creator.display_name ?? "there"),
      startingPriceCents: priceByCreator.get(creator.id) ?? 0,
      idempotencyKey: `listing-activation-${creator.id}-${period}`,
    });
    if (!result.sent) {
      summary.skipped += 1;
      continue;
    }

    await db.from("listing_activation_reminders").upsert(
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
