import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MessagingActorKind = "creator" | "sponsor";

type Actor = {
  kind: MessagingActorKind;
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type InboxConversation = {
  id: string;
  counterpartName: string;
  counterpartHandle: string | null;
  counterpartAvatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  isCurrentSponsor: boolean;
  blocked: boolean;
  canMessage: boolean;
};

export type InboxMessage = {
  id: string;
  senderKind: MessagingActorKind;
  body: string;
  createdAt: string;
};

export type InboxNotification = {
  id: string;
  type: "NEW_SPONSOR" | "SPONSORSHIP_UNLOCKED" | "NEW_MESSAGE" | "OUTBID";
  title: string;
  body: string;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
};

const authInput = z.object({
  token: z.string().max(5000).optional().nullable(),
  actorKind: z.enum(["creator", "sponsor"]).optional().nullable(),
});

const conversationInput = authInput.extend({
  conversationId: z.string().uuid(),
});

async function resolveCreator(db: SupabaseClient) {
  const { creatorSessionToken } = await import("./creator-session.server");
  const sessionToken = creatorSessionToken();
  if (!sessionToken) return null;
  const { data } = await db
    .from("creators")
    .select("id, display_name, username, x_profile_image_url")
    .eq("session_token", sessionToken)
    .maybeSingle();
  if (!data) return null;
  return {
    kind: "creator" as const,
    id: String(data.id),
    name: String(data.display_name),
    avatarUrl: (data.x_profile_image_url as string | null) ?? null,
  };
}

/**
 * Claims a buyer record only through a confirmed Supabase Auth email matching
 * the checkout email. Company names and client-supplied buyer IDs are never
 * accepted as proof of sponsor identity.
 */
async function resolveSponsor(
  db: SupabaseClient,
  token: string | null | undefined,
): Promise<Actor | null> {
  if (!token) return null;
  const { data: authData, error: authError } = await db.auth.getUser(token);
  const user = authData.user;
  const email = user?.email?.trim().toLowerCase();
  if (authError || !user || !email || !user.email_confirmed_at) return null;

  let { data: buyer } = await db
    .from("buyers")
    .select("id, user_id, company_name, email")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!buyer) {
    const byEmail = await db
      .from("buyers")
      .select("id, user_id, company_name, email")
      .eq("email", email)
      .maybeSingle();
    buyer = byEmail.data;
  }
  if (!buyer || String(buyer.email).trim().toLowerCase() !== email) return null;
  if (buyer.user_id && buyer.user_id !== user.id) return null;

  if (!buyer.user_id) {
    const { data: bound, error } = await db
      .from("buyers")
      .update({ user_id: user.id })
      .eq("id", buyer.id)
      .is("user_id", null)
      .select("id, user_id, company_name, email")
      .maybeSingle();
    if (error) throw new Error("Sponsor identity could not be linked.");
    if (!bound) {
      const { data: raced } = await db
        .from("buyers")
        .select("id, user_id, company_name, email")
        .eq("id", buyer.id)
        .maybeSingle();
      if (!raced || raced.user_id !== user.id) return null;
      buyer = raced;
    } else {
      buyer = bound;
    }
  }

  return {
    kind: "sponsor",
    id: String(buyer.id),
    name: String(buyer.company_name || email),
    avatarUrl: null,
  };
}

async function resolveActors(token: string | null | undefined) {
  const { admin } = await import("./db.server");
  const db = admin();
  const [creator, sponsor] = await Promise.all([resolveCreator(db), resolveSponsor(db, token)]);
  return { db, creator, sponsor };
}

function chooseActor(
  creator: Actor | null,
  sponsor: Actor | null,
  requested: MessagingActorKind | null | undefined,
) {
  if (requested === "creator" && creator) return creator;
  if (requested === "sponsor" && sponsor) return sponsor;
  if (requested) return null;
  return creator ?? sponsor;
}

async function hasSponsorshipConnection(db: SupabaseClient, creatorId: string, buyerId: string) {
  const { data: listing } = await db
    .from("listings")
    .select("id")
    .eq("creator_id", creatorId)
    .maybeSingle();
  if (!listing) return false;
  const { data: payments } = await db
    .from("payments")
    .select("id")
    .eq("listing_id", listing.id)
    .eq("buyer_id", buyerId)
    .eq("status", "applied");
  const paymentIds = (payments ?? []).map((payment) => String(payment.id));
  if (!paymentIds.length) return false;
  const { data: ownership } = await db
    .from("ownerships")
    .select("id")
    .eq("listing_id", listing.id)
    .eq("buyer_id", buyerId)
    .in("payment_id", paymentIds)
    .limit(1)
    .maybeSingle();
  return Boolean(ownership);
}

/** Repairs/backfills convenience conversation rows from authoritative history. */
async function syncConnectionsForActor(db: SupabaseClient, actor: Actor) {
  let paymentsQuery = db
    .from("payments")
    .select("id, listing_id, buyer_id, created_at, updated_at")
    .eq("status", "applied")
    .not("buyer_id", "is", null)
    .order("created_at", { ascending: true });

  if (actor.kind === "sponsor") {
    paymentsQuery = paymentsQuery.eq("buyer_id", actor.id);
  } else {
    const { data: listings } = await db.from("listings").select("id").eq("creator_id", actor.id);
    const listingIds = (listings ?? []).map((listing) => String(listing.id));
    if (!listingIds.length) return;
    paymentsQuery = paymentsQuery.in("listing_id", listingIds);
  }

  const { data: payments, error } = await paymentsQuery;
  if (error) throw new Error("Sponsorship connections could not be synchronized.");
  for (const payment of payments ?? []) {
    const buyerId = String(payment.buyer_id);
    const { data: ownership } = await db
      .from("ownerships")
      .select("id")
      .eq("payment_id", payment.id)
      .eq("listing_id", payment.listing_id)
      .eq("buyer_id", buyerId)
      .maybeSingle();
    if (!ownership) continue;
    const { data: listing } = await db
      .from("listings")
      .select("creator_id")
      .eq("id", payment.listing_id)
      .maybeSingle();
    if (!listing) continue;
    const insert = await db.from("social_bid_conversations").upsert(
      {
        creator_id: listing.creator_id,
        buyer_id: buyerId,
        unlocked_by_payment_id: payment.id,
        latest_sponsorship_payment_id: payment.id,
        updated_at: payment.updated_at,
      },
      { onConflict: "creator_id,buyer_id", ignoreDuplicates: true },
    );
    if (insert.error) throw new Error("Sponsorship connection could not be synchronized.");
    const { error: updateError } = await db
      .from("social_bid_conversations")
      .update({ latest_sponsorship_payment_id: payment.id })
      .eq("creator_id", listing.creator_id)
      .eq("buyer_id", buyerId);
    if (updateError) throw new Error("Sponsorship connection could not be synchronized.");
  }
}

async function authorizedConversation(db: SupabaseClient, actor: Actor, conversationId: string) {
  const { data: conversation } = await db
    .from("social_bid_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const belongs =
    actor.kind === "creator"
      ? conversation.creator_id === actor.id
      : conversation.buyer_id === actor.id;
  if (!belongs) return null;
  const entitled = await hasSponsorshipConnection(
    db,
    String(conversation.creator_id),
    String(conversation.buyer_id),
  );
  return entitled ? conversation : null;
}

export const getMessagingContext = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => authInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) {
      return {
        actor: null,
        availableKinds: [] as MessagingActorKind[],
        conversations: [] as InboxConversation[],
        notifications: [] as InboxNotification[],
        unreadNotifications: 0,
      };
    }

    const availableKinds = [creator && "creator", sponsor && "sponsor"].filter(
      Boolean,
    ) as MessagingActorKind[];
    await syncConnectionsForActor(db, actor);
    const matchColumn = actor.kind === "creator" ? "creator_id" : "buyer_id";
    const { data: conversationRows, error: conversationError } = await db
      .from("social_bid_conversations")
      .select("*")
      .eq(matchColumn, actor.id)
      .order("updated_at", { ascending: false });
    if (conversationError) throw new Error("Inbox could not be loaded.");

    const conversations: InboxConversation[] = [];
    for (const conversation of conversationRows ?? []) {
      const creatorId = String(conversation.creator_id);
      const buyerId = String(conversation.buyer_id);
      if (!(await hasSponsorshipConnection(db, creatorId, buyerId))) continue;
      const [
        { data: creatorRow },
        { data: buyerRow },
        { data: sponsorPayment },
        { data: latest },
        { count: unreadCount },
      ] = await Promise.all([
        db
          .from("creators")
          .select("display_name, username, x_profile_image_url")
          .eq("id", creatorId)
          .maybeSingle(),
        db.from("buyers").select("company_name").eq("id", buyerId).maybeSingle(),
        db
          .from("payments")
          .select("company_name, logo_url")
          .eq("id", conversation.latest_sponsorship_payment_id)
          .maybeSingle(),
        db
          .from("social_bid_messages")
          .select("body, created_at, sender_kind")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("social_bid_messages")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversation.id)
          .neq("sender_kind", actor.kind)
          .gt(
            "created_at",
            (actor.kind === "creator"
              ? conversation.creator_last_read_at
              : conversation.sponsor_last_read_at) ?? "1970-01-01T00:00:00.000Z",
          ),
      ]);
      const { data: creatorListing } = await db
        .from("listings")
        .select("id")
        .eq("creator_id", creatorId)
        .maybeSingle();
      const { data: active } = creatorListing
        ? await db
            .from("ownerships")
            .select("id")
            .eq("buyer_id", buyerId)
            .eq("listing_id", creatorListing.id)
            .eq("status", "active")
            .limit(1)
            .maybeSingle()
        : { data: null };
      const blocked = Boolean(
        conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at,
      );
      conversations.push({
        id: String(conversation.id),
        counterpartName:
          actor.kind === "creator"
            ? String(sponsorPayment?.company_name || buyerRow?.company_name || "Sponsor")
            : String(creatorRow?.display_name || "Creator"),
        counterpartHandle:
          actor.kind === "sponsor" && creatorRow?.username ? String(creatorRow.username) : null,
        counterpartAvatarUrl:
          actor.kind === "sponsor"
            ? ((creatorRow?.x_profile_image_url as string | null) ?? null)
            : ((sponsorPayment?.logo_url as string | null) ?? null),
        lastMessage: (latest?.body as string | null) ?? null,
        lastMessageAt: (latest?.created_at as string | null) ?? null,
        unreadCount: unreadCount ?? 0,
        isCurrentSponsor: Boolean(active),
        blocked,
        canMessage: !blocked,
      });
    }

    const notificationColumn = actor.kind === "creator" ? "creator_id" : "buyer_id";
    const { data: notificationRows, error: notificationError } = await db
      .from("social_bid_notifications")
      .select("id, notification_type, title, body, conversation_id, read_at, created_at")
      .eq(notificationColumn, actor.id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (notificationError) throw new Error("Notifications could not be loaded.");
    const notifications = (notificationRows ?? []).map((row) => ({
      id: String(row.id),
      type: row.notification_type as InboxNotification["type"],
      title: String(row.title),
      body: String(row.body),
      conversationId: (row.conversation_id as string | null) ?? null,
      readAt: (row.read_at as string | null) ?? null,
      createdAt: String(row.created_at),
    }));

    return {
      actor: { kind: actor.kind, name: actor.name, avatarUrl: actor.avatarUrl },
      availableKinds,
      conversations,
      notifications,
      unreadNotifications: notifications.filter((notification) => !notification.readAt).length,
    };
  });

export const getConversationMessages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => conversationInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) return { error: "Sign in to view this conversation." } as const;
    const conversation = await authorizedConversation(db, actor, data.conversationId);
    if (!conversation) return { error: "Conversation unavailable." } as const;
    const { data: rows, error } = await db
      .from("social_bid_messages")
      .select("id, sender_kind, body, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return { error: "Messages could not be loaded." } as const;
    const readColumn = actor.kind === "creator" ? "creator_last_read_at" : "sponsor_last_read_at";
    await db
      .from("social_bid_conversations")
      .update({ [readColumn]: new Date().toISOString() })
      .eq("id", data.conversationId);
    return {
      messages: (rows ?? []).map((row) => ({
        id: String(row.id),
        senderKind: row.sender_kind as MessagingActorKind,
        body: String(row.body),
        createdAt: String(row.created_at),
      })) as InboxMessage[],
      blocked: Boolean(conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at),
    } as const;
  });

const sendInput = conversationInput.extend({ body: z.string().trim().min(1).max(2000) });

export const sendInboxMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => sendInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) return { error: "Sign in to send a message." } as const;
    const conversation = await authorizedConversation(db, actor, data.conversationId);
    if (!conversation) return { error: "Conversation unavailable." } as const;
    if (conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at)
      return { error: "Messaging is blocked for this conversation." } as const;
    const { data: message, error } = await db
      .from("social_bid_messages")
      .insert({
        conversation_id: data.conversationId,
        sender_kind: actor.kind,
        body: data.body.trim(),
      })
      .select("id, sender_kind, body, created_at")
      .single();
    if (error || !message) return { error: "Message could not be sent." } as const;
    await db
      .from("social_bid_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    return {
      message: {
        id: String(message.id),
        senderKind: message.sender_kind as MessagingActorKind,
        body: String(message.body),
        createdAt: String(message.created_at),
      } as InboxMessage,
    } as const;
  });

const blockInput = conversationInput.extend({ blocked: z.boolean() });

export const setConversationBlocked = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => blockInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) return { error: "Sign in to manage this conversation." } as const;
    const conversation = await authorizedConversation(db, actor, data.conversationId);
    if (!conversation) return { error: "Conversation unavailable." } as const;
    const column = actor.kind === "creator" ? "blocked_by_creator_at" : "blocked_by_sponsor_at";
    const { error } = await db
      .from("social_bid_conversations")
      .update({ [column]: data.blocked ? new Date().toISOString() : null })
      .eq("id", data.conversationId);
    return error
      ? ({ error: "Block setting could not be saved." } as const)
      : ({ ok: true } as const);
  });

const reportInput = conversationInput.extend({ reason: z.string().trim().max(500).optional() });

export const reportConversation = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => reportInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) return { error: "Sign in to report this conversation." } as const;
    const conversation = await authorizedConversation(db, actor, data.conversationId);
    if (!conversation) return { error: "Conversation unavailable." } as const;
    const { error } = await db.from("social_bid_conversation_reports").insert({
      conversation_id: data.conversationId,
      reporter_kind: actor.kind,
      reason: data.reason?.trim() || null,
    });
    return error ? ({ error: "Report could not be submitted." } as const) : ({ ok: true } as const);
  });

const notificationInput = authInput.extend({ notificationId: z.string().uuid().optional() });

export const markNotificationsRead = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => notificationInput.parse(input))
  .handler(async ({ data }) => {
    const { db, creator, sponsor } = await resolveActors(data.token);
    const actor = chooseActor(creator, sponsor, data.actorKind);
    if (!actor) return { error: "Sign in to manage notifications." } as const;
    const column = actor.kind === "creator" ? "creator_id" : "buyer_id";
    let query = db
      .from("social_bid_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq(column, actor.id);
    if (data.notificationId) query = query.eq("id", data.notificationId);
    const { error } = await query;
    return error
      ? ({ error: "Notification could not be updated." } as const)
      : ({ ok: true } as const);
  });
