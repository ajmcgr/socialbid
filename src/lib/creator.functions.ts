import { buildPlacementText, normalizeFormat } from "./placement";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const creatorSessionIn = z.object({});

export type CreatorSession = {
  username: string;
  displayName: string;
  handle: string | null;
  profileImageUrl: string | null;
  profileUrl: string | null;
  /** The creator's stored X bio/description snapshot. */
  bio: string | null;
  followers: number;
  accountVerified: boolean;
  bioVerified: boolean;
  bioVerifiedMethod: string | null;
  listingStatus: string | null;
  /** True only when this creator is in the same public marketplace dataset as the homepage. */
  publiclyListed: boolean;
  requiredPlacement: string;
  banned: boolean;
  startingPriceCents: number | null;
  bioValueCents: number | null;
  globalRank: number | null;
  ownerName: string | null;
  ownerLogoUrl: string | null;
  ownerMessage: string | null;
  ownerUrl: string | null;
  /** Exact sponsored message shown on the creator's Social Bid profile. */
  ownerPlacement: string | null;
  compliance: { status: string; reason: string | null } | null;
  activation: {
    status: string;
    deadline: string | null;
    firstVerifiedAt: string | null;
  } | null;
  notificationEmail: string | null;
};

export const getCreatorSession = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }): Promise<CreatorSession | null> => {
    const [{ admin }, { creatorSessionToken }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
    ]);
    const { requiredPlacement } = await import("./x.server");
    const db = admin();
    const token = creatorSessionToken();
    if (!token) return null;

    const { data: c } = await db
      .from("creators")
      .select(
        "id, username, display_name, x_username, x_profile_image_url, x_profile_url, x_follower_count, x_account_verified, x_bio_verified, x_bio_verified_method, x_bio_snapshot, banned",
      )
      .eq("session_token", token)
      .maybeSingle();
    if (!c) return null;

    const { data: notification } = await db
      .from("creator_notification_emails")
      .select("notification_email")
      .eq("creator_id", c.id)
      .maybeSingle();

    // Keep this lookup for dashboard-only metadata, but do not use it to decide
    // whether the profile is public. The marketplace snapshot below is the
    // canonical public-listing definition used by the homepage.
    const { data: listing } = await db
      .from("listings")
      .select("id, status, compliance_status, non_compliant_reason")
      .eq("creator_id", c.id)
      .maybeSingle();

    const { loadMarketplace } = await import("./marketplace.server");
    const market = await loadMarketplace("new");
    const marketRow =
      [...market.rows, ...market.unowned].find((row) => row.creator.id === c.id) ?? null;
    const listingId = marketRow?.listing.id ?? listing?.id ?? null;
    const listingStatus = marketRow?.listing.status ?? listing?.status ?? null;

    let ownerMessage: string | null = null;
    let ownerLogoUrl: string | null = null;
    let ownerFormat: string | null = null;
    let ownerUrl: string | null = null;
    let activation: CreatorSession["activation"] = null;
    if (listingId) {
      const { data: ownership } = await db
        .from("ownerships")
        .select(
          "bio_message, destination_url, logo_url, placement_format, placement_status, activation_deadline, first_verified_at",
        )
        .eq("status", "active")
        .eq("listing_id", listingId)
        .maybeSingle();
      ownerMessage = (ownership?.bio_message as string | null) ?? null;
      ownerFormat = (ownership?.placement_format as string | null) ?? null;
      ownerUrl = (ownership?.destination_url as string | null) ?? null;
      ownerLogoUrl = (ownership?.logo_url as string | null) ?? null;
      if (ownership) {
        activation = {
          status: String(ownership.placement_status ?? "active"),
          deadline: (ownership.activation_deadline as string | null) ?? null,
          firstVerifiedAt: (ownership.first_verified_at as string | null) ?? null,
        };
      }
    }

    return {
      username: c.username,
      displayName: c.display_name,
      handle: c.x_username ?? null,
      profileImageUrl: c.x_profile_image_url ?? null,
      profileUrl: c.x_profile_url ?? null,
      bio: (c.x_bio_snapshot as string | null) ?? null,
      followers: Number(c.x_follower_count ?? 0),
      accountVerified: Boolean(c.x_account_verified),
      bioVerified: Boolean(c.x_bio_verified),
      bioVerifiedMethod: c.x_bio_verified_method ?? null,
      listingStatus,
      // This is deliberately derived from loadMarketplace rather than a
      // dashboard-only flag or the direct listings lookup above. It guarantees
      // that the homepage, marketplace and creator dashboard share one public
      // listing definition.
      publiclyListed: Boolean(marketRow),
      requiredPlacement: requiredPlacement(c.username),
      banned: Boolean(c.banned),
      startingPriceCents: marketRow?.listing.starting_price_cents ?? null,
      bioValueCents: marketRow?.bioValueCents ?? null,
      globalRank: marketRow?.globalRank ?? null,
      ownerName: marketRow?.owner?.company_name ?? null,
      ownerLogoUrl: marketRow?.owner?.logo_url ?? ownerLogoUrl,
      ownerMessage,
      ownerUrl,
      ownerPlacement: ownerMessage
        ? buildPlacementText(ownerMessage, ownerUrl, normalizeFormat(ownerFormat))
        : null,
      activation,
      notificationEmail: (notification?.notification_email as string | null) ?? null,
      compliance: listing
        ? {
            status: String(listing.compliance_status ?? "compliant"),
            reason: (listing.non_compliant_reason as string | null) ?? null,
          }
        : null,
    };
  });

const notificationEmailIn = z.object({ email: z.string().trim().max(160) });

export const updateNotificationEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => notificationEmailIn.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, { creatorSessionToken }, { isDeliverableEmail }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
      import("./validate"),
    ]);
    const email = data.email.trim().toLowerCase();
    if (!isDeliverableEmail(email))
      return { error: "Enter a valid email address for notifications." } as const;

    const token = creatorSessionToken();
    if (!token) return { error: "Session expired. Connect X again." } as const;
    const db = admin();
    const { data: creator } = await db
      .from("creators")
      .select("id")
      .eq("session_token", token)
      .maybeSingle();
    if (!creator) return { error: "Session expired. Connect X again." } as const;
    const { data: notification, error } = await db
      .from("creator_notification_emails")
      .upsert(
        {
          creator_id: creator.id,
          notification_email: email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "creator_id" },
      )
      .select("notification_email")
      .maybeSingle();
    if (error || !notification)
      return { error: "We couldn't save your notification email. Please try again." } as const;
    return { notificationEmail: String(notification.notification_email) } as const;
  });

/**
 * Explicit creator opt-in. Connecting X only verifies identity; a profile is
 * never listed publicly until the creator clicks "List my profile".
 */
export const publishListing = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => creatorSessionIn.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, { creatorSessionToken }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
    ]);
    const db = admin();
    const token = creatorSessionToken();
    if (!token) return { error: "Session expired. Connect X again." } as const;
    const { data: c } = await db
      .from("creators")
      .select("id, banned, x_account_verified")
      .eq("session_token", token)
      .maybeSingle();
    if (!c || c.banned) return { error: "Session expired. Connect X again." } as const;
    if (!c.x_account_verified) return { error: "Connect X before listing your profile." } as const;
    const { data: listing, error } = await db
      .from("listings")
      .update({ status: "active" })
      .eq("creator_id", c.id)
      .select("id, status")
      .maybeSingle();
    if (error || !listing || listing.status !== "active")
      return { error: "We couldn't publish your listing. Please try again." } as const;
    return { ok: true } as const;
  });

const disconnectIn = z.object({
  deleteData: z.boolean().optional(),
});

/**
 * Disconnect the creator's X account (and optionally delete their Social Bid data).
 *
 * Disconnecting is always allowed, but it NEVER cancels an obligation:
 * - the profile is removed from public discovery and cannot accept new sponsorships,
 * - live/awaiting sponsorships, payouts, refunds and violation history are untouched,
 * - X identity fields are retained privately so a future reconnect resolves
 *   to the same creator.
 * Hard deletion is refused while an obligation or any payment history exists.
 */
export const disconnectXAccount = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => disconnectIn.parse(input))
  .handler(async ({ data }) => {
    const [{ admin }, { creatorSessionToken }] = await Promise.all([
      import("./db.server"),
      import("./creator-session.server"),
    ]);
    const db = admin();
    const token = creatorSessionToken();
    if (!token) return { error: "Session expired. Connect X again." } as const;

    const { data: c } = await db
      .from("creators")
      .select("id")
      .eq("session_token", token)
      .maybeSingle();
    if (!c) return { error: "Session expired. Connect X again." } as const;

    const { data: listing } = await db
      .from("listings")
      .select("id")
      .eq("creator_id", c.id)
      .maybeSingle();

    let hasObligation = false;
    if (listing) {
      const { data: live } = await db
        .from("ownerships")
        .select("id")
        .eq("listing_id", listing.id)
        .eq("status", "active")
        .limit(1);
      if (live && live.length > 0) hasObligation = true;
    }

    const { data: openPayout } = await db
      .from("payouts")
      .select("id")
      .eq("creator_id", c.id)
      .in("status", ["pending", "blocked"])
      .limit(1);
    if (openPayout && openPayout.length > 0) hasObligation = true;

    // Stop new buyers either way. Existing obligations continue unchanged.
    if (listing) await db.from("listings").update({ status: "disconnected" }).eq("id", listing.id);

    const wipe: Record<string, unknown> = {
      session_token: null,
      updated_at: new Date().toISOString(),
      x_account_verified: false,
      x_account_verified_at: null,
      x_bio_verified: false,
      x_bio_verified_at: null,
      x_bio_verified_method: null,
    };
    await db.from("creators").update(wipe).eq("id", c.id);

    if (!data.deleteData) return { ok: true, deleted: false, hasObligation } as const;

    // Only hard-delete when nothing is owed and no money ever moved.
    let hasPayments = false;
    if (listing) {
      const { data: pay } = await db
        .from("payments")
        .select("id")
        .eq("listing_id", listing.id)
        .limit(1);
      hasPayments = Boolean(pay && pay.length > 0);
    }
    if (hasObligation || hasPayments)
      return { ok: true, deleted: false, retained: true, hasObligation } as const;

    await db.from("creators").delete().eq("id", c.id);
    return { ok: true, deleted: true, hasObligation: false } as const;
  });
