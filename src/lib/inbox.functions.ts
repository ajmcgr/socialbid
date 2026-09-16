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

type AccountAccess = {
  userId: string;
  creators: Actor[];
  sponsors: Actor[];
};

export type InboxConversation = {
  id: string;
  actorKind: MessagingActorKind;
  counterpartName: string;
  counterpartHandle: string | null;
  counterpartAvatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  lastActivityAt: string;
  unreadCount: number;
  isUnread: boolean;
  isCurrentSponsor: boolean;
  relationshipLabel: string;
  blocked: boolean;
  canMessage: boolean;
};

export type InboxMessage = {
  id: string;
  senderKind: MessagingActorKind;
  body: string;
  createdAt: string;
  attachments: InboxAttachment[];
};

export type InboxAttachment = {
  id: string;
  filename: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
  sizeBytes: number;
  previewUrl: string | null;
};

export type InboxNotification = {
  id: string;
  actorKind: MessagingActorKind;
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

const MESSAGE_ATTACHMENT_BUCKET = "social-bid-message-attachments";
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const ATTACHMENT_PREVIEW_SECONDS = 10 * 60;
const allowedAttachmentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
type AttachmentMimeType = (typeof allowedAttachmentTypes)[number];

const extensionsByMime: Record<AttachmentMimeType, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

function safeFilename(value: string) {
  const basename = value.split(/[\\/]/).pop() ?? "attachment";
  const withoutControls = [...basename.normalize("NFKC")]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("");
  const cleaned = withoutControls
    .replace(/[^\p{L}\p{N}._ ()-]/gu, "_")
    .trim()
    .slice(0, 180);
  return cleaned || "attachment";
}

function extensionFor(filename: string) {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function detectAttachmentType(bytes: Uint8Array): AttachmentMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-")
    return "application/pdf";
  return null;
}

async function resolveAccountAccess(
  db: SupabaseClient,
  token: string | null | undefined,
): Promise<AccountAccess | null> {
  const { resolveCanonicalAccount } = await import("./account.server");
  const account = await resolveCanonicalAccount(db, token);
  if (!account) return null;
  // A guest claim is the only automatic linkage path. It is an HttpOnly,
  // one-time capability bound to an exact successfully applied payment/buyer.
  const { consumeGuestBuyerClaim } = await import("./account-claims.server");
  await consumeGuestBuyerClaim(db, account.userId);
  const [{ data: creatorRows, error: creatorError }, { data: buyerRows, error: buyerError }] =
    await Promise.all([
      db
        .from("creators")
        .select("id, display_name, username, x_profile_image_url")
        .eq("user_id", account.userId),
      db.from("buyers").select("id, company_name, email").eq("user_id", account.userId),
    ]);
  if (creatorError || buyerError) throw new Error("SocialBid account could not be resolved.");
  return {
    userId: account.userId,
    creators: (creatorRows ?? []).map((row) => ({
      kind: "creator" as const,
      id: String(row.id),
      name: String(row.display_name),
      avatarUrl: (row.x_profile_image_url as string | null) ?? null,
    })),
    sponsors: (buyerRows ?? []).map((row) => ({
      kind: "sponsor" as const,
      id: String(row.id),
      name: String(row.company_name || row.email || "Sponsor"),
      avatarUrl: null,
    })),
  };
}

async function resolveAccess(token: string | null | undefined) {
  const { admin } = await import("./db.server");
  const db = admin();
  const access = await resolveAccountAccess(db, token);
  return { db, access };
}

function chooseActorForConversation(
  access: AccountAccess,
  conversation: Record<string, unknown>,
  requested: MessagingActorKind | null | undefined,
) {
  const creator = access.creators.find((item) => item.id === conversation["creator_id"]);
  const sponsor = access.sponsors.find((item) => item.id === conversation["buyer_id"]);
  if (requested === "creator") return creator ?? null;
  if (requested === "sponsor") return sponsor ?? null;
  return creator ?? sponsor ?? null;
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

async function authorizedConversation(
  db: SupabaseClient,
  access: AccountAccess,
  conversationId: string,
  requested?: MessagingActorKind | null,
) {
  const { data: conversation } = await db
    .from("social_bid_conversations")
    .select("*")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversation) return null;
  const actor = chooseActorForConversation(access, conversation, requested);
  if (!actor) return null;
  const entitled = await hasSponsorshipConnection(
    db,
    String(conversation.creator_id),
    String(conversation.buyer_id),
  );
  return entitled ? { conversation, actor } : null;
}

async function loadConversationForActor(
  db: SupabaseClient,
  actor: Actor,
  conversation: Record<string, unknown>,
): Promise<InboxConversation | null> {
  const creatorId = String(conversation["creator_id"]);
  const buyerId = String(conversation["buyer_id"]);
  if (!(await hasSponsorshipConnection(db, creatorId, buyerId))) return null;
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
    db.from("buyers").select("company_name, user_id").eq("id", buyerId).maybeSingle(),
    db
      .from("payments")
      .select("company_name, logo_url")
      .eq("id", conversation["latest_sponsorship_payment_id"])
      .maybeSingle(),
    db
      .from("social_bid_messages")
      .select("body, created_at, sender_kind, has_attachments")
      .eq("conversation_id", conversation["id"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from("social_bid_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversation["id"])
      .neq("sender_kind", actor.kind)
      .gt(
        "created_at",
        (actor.kind === "creator"
          ? conversation["creator_last_read_at"]
          : conversation["sponsor_last_read_at"]) ?? "1970-01-01T00:00:00.000Z",
      ),
  ]);
  const { data: buyerXIdentity } =
    actor.kind === "creator" && buyerRow?.user_id
      ? await db
          .from("creators")
          .select("x_profile_image_url")
          .eq("user_id", buyerRow.user_id)
          .not("x_profile_image_url", "is", null)
          .limit(1)
          .maybeSingle()
      : { data: null };
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
  const isCurrentSponsor = Boolean(active);
  const manuallyUnread = Boolean(
    actor.kind === "creator"
      ? conversation["creator_marked_unread_at"]
      : conversation["sponsor_marked_unread_at"],
  );
  const effectiveUnreadCount = Math.max(unreadCount ?? 0, manuallyUnread ? 1 : 0);
  const blocked = Boolean(
    conversation["blocked_by_creator_at"] || conversation["blocked_by_sponsor_at"],
  );
  return {
    id: String(conversation["id"]),
    actorKind: actor.kind,
    counterpartName:
      actor.kind === "creator"
        ? String(sponsorPayment?.company_name || buyerRow?.company_name || "Sponsor")
        : String(creatorRow?.display_name || "Creator"),
    counterpartHandle:
      actor.kind === "sponsor" && creatorRow?.username ? String(creatorRow.username) : null,
    counterpartAvatarUrl:
      actor.kind === "sponsor"
        ? ((creatorRow?.x_profile_image_url as string | null) ?? null)
        : ((buyerXIdentity?.x_profile_image_url as string | null) ??
          (sponsorPayment?.logo_url as string | null) ??
          null),
    lastMessage:
      (latest?.body as string | null) || (latest?.has_attachments ? "Sent an attachment." : null),
    lastMessageAt: (latest?.created_at as string | null) ?? null,
    lastActivityAt: String(
      latest?.created_at || conversation["updated_at"] || conversation["created_at"],
    ),
    unreadCount: effectiveUnreadCount,
    isUnread: effectiveUnreadCount > 0,
    isCurrentSponsor,
    relationshipLabel:
      actor.kind === "creator"
        ? `${isCurrentSponsor ? "Current" : "Previous"} sponsor · Sponsored you`
        : `You ${isCurrentSponsor ? "sponsor them · Current" : "sponsored them · Previous"}`,
    blocked,
    canMessage: !blocked,
  };
}

export const getMessagingContext = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => authInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    const actors = access ? [...access.creators, ...access.sponsors] : [];
    if (!actors.length) {
      return {
        actor: null,
        accountAuthenticated: Boolean(access),
        availableKinds: [] as MessagingActorKind[],
        conversations: [] as InboxConversation[],
        notifications: [] as InboxNotification[],
        unreadNotifications: 0,
      };
    }

    // A valid account remains signed in even before it owns a creator/buyer.
    const availableKinds = [...new Set(actors.map((actor) => actor.kind))];
    await Promise.all(actors.map((actor) => syncConnectionsForActor(db, actor)));

    const conversationMap = new Map<string, InboxConversation>();
    const notificationMap = new Map<string, InboxNotification>();
    for (const actor of actors) {
      const matchColumn = actor.kind === "creator" ? "creator_id" : "buyer_id";
      const { data: conversationRows, error: conversationError } = await db
        .from("social_bid_conversations")
        .select("*")
        .eq(matchColumn, actor.id)
        .order("updated_at", { ascending: false });
      if (conversationError) throw new Error("Inbox could not be loaded.");
      for (const conversation of conversationRows ?? []) {
        const conversationId = String(conversation.id);
        if (conversationMap.has(conversationId)) continue;
        const loaded = await loadConversationForActor(db, actor, conversation);
        if (loaded) conversationMap.set(conversationId, loaded);
      }

      const notificationColumn = actor.kind === "creator" ? "creator_id" : "buyer_id";
      const { data: notificationRows, error: notificationError } = await db
        .from("social_bid_notifications")
        .select("id, notification_type, title, body, conversation_id, read_at, created_at")
        .eq(notificationColumn, actor.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (notificationError) throw new Error("Notifications could not be loaded.");
      for (const row of notificationRows ?? []) {
        const notificationId = String(row.id);
        if (notificationMap.has(notificationId)) continue;
        notificationMap.set(notificationId, {
          id: notificationId,
          actorKind: actor.kind,
          type: row.notification_type as InboxNotification["type"],
          title: String(row.title),
          body: String(row.body),
          conversationId: (row.conversation_id as string | null) ?? null,
          readAt: (row.read_at as string | null) ?? null,
          createdAt: String(row.created_at),
        });
      }
    }

    const conversations = [...conversationMap.values()].sort(
      (a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    );
    const notifications = [...notificationMap.values()]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, 100);
    const actor = actors[0]!;

    return {
      actor: { kind: actor.kind, name: actor.name, avatarUrl: actor.avatarUrl },
      accountAuthenticated: true,
      availableKinds,
      conversations,
      notifications,
      unreadNotifications: notifications.filter((notification) => !notification.readAt).length,
    };
  });

export const getConversationMessages = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => conversationInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to view this conversation." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { conversation, actor } = authorized;
    const { data: rows, error } = await db
      .from("social_bid_messages")
      .select("id, sender_kind, body, created_at")
      .eq("conversation_id", data.conversationId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) return { error: "Messages could not be loaded." } as const;
    const messageIds = (rows ?? []).map((row) => String(row.id));
    const { data: attachmentRows, error: attachmentError } = messageIds.length
      ? await db
          .from("social_bid_message_attachments")
          .select("id, message_id, storage_path, original_filename, mime_type, size_bytes")
          .in("message_id", messageIds)
          .eq("status", "ready")
          .order("created_at", { ascending: true })
      : { data: [], error: null };
    if (attachmentError) return { error: "Attachments could not be loaded." } as const;
    const attachmentsByMessage = new Map<string, InboxAttachment[]>();
    await Promise.all(
      (attachmentRows ?? []).map(async (attachment) => {
        const mimeType = attachment.mime_type as AttachmentMimeType;
        let previewUrl: string | null = null;
        if (mimeType.startsWith("image/")) {
          const signed = await db.storage
            .from(MESSAGE_ATTACHMENT_BUCKET)
            .createSignedUrl(String(attachment.storage_path), ATTACHMENT_PREVIEW_SECONDS);
          previewUrl = signed.data?.signedUrl ?? null;
        }
        const messageId = String(attachment.message_id);
        const items = attachmentsByMessage.get(messageId) ?? [];
        items.push({
          id: String(attachment.id),
          filename: String(attachment.original_filename),
          mimeType,
          sizeBytes: Number(attachment.size_bytes),
          previewUrl,
        });
        attachmentsByMessage.set(messageId, items);
      }),
    );
    const readColumn = actor.kind === "creator" ? "creator_last_read_at" : "sponsor_last_read_at";
    const markedUnreadColumn =
      actor.kind === "creator" ? "creator_marked_unread_at" : "sponsor_marked_unread_at";
    const { error: readError } = await db
      .from("social_bid_conversations")
      .update({ [readColumn]: new Date().toISOString(), [markedUnreadColumn]: null })
      .eq("id", data.conversationId);
    if (readError) return { error: "Conversation read state could not be updated." } as const;
    return {
      messages: (rows ?? []).map((row) => ({
        id: String(row.id),
        senderKind: row.sender_kind as MessagingActorKind,
        body: String(row.body),
        createdAt: String(row.created_at),
        attachments: attachmentsByMessage.get(String(row.id)) ?? [],
      })) as InboxMessage[],
      blocked: Boolean(conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at),
    } as const;
  });

const readStateInput = conversationInput.extend({ unread: z.boolean() });

export const setConversationReadState = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => readStateInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to manage this conversation." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { actor } = authorized;
    const readColumn = actor.kind === "creator" ? "creator_last_read_at" : "sponsor_last_read_at";
    const markedUnreadColumn =
      actor.kind === "creator" ? "creator_marked_unread_at" : "sponsor_marked_unread_at";
    const now = new Date().toISOString();
    const update = data.unread
      ? { [markedUnreadColumn]: now }
      : { [readColumn]: now, [markedUnreadColumn]: null };
    const { error } = await db
      .from("social_bid_conversations")
      .update(update)
      .eq("id", data.conversationId);
    return error
      ? ({ error: "Conversation read state could not be updated." } as const)
      : ({ ok: true } as const);
  });

const attachmentUploadInput = conversationInput.extend({
  filename: z.string().min(1).max(255),
  mimeType: z.enum(allowedAttachmentTypes),
  sizeBytes: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
});

export const createAttachmentUpload = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => attachmentUploadInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to attach a file." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { conversation, actor } = authorized;
    if (conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at)
      return { error: "Messaging is blocked for this conversation." } as const;

    const filename = safeFilename(data.filename);
    const extension = extensionFor(filename);
    if (!extensionsByMime[data.mimeType].includes(extension))
      return { error: "The file extension and file type do not match." } as const;

    const attachmentId = crypto.randomUUID();
    const storagePath = `${data.conversationId}/${crypto.randomUUID()}.${extension}`;
    const { error: insertError } = await db.from("social_bid_message_attachments").insert({
      id: attachmentId,
      conversation_id: data.conversationId,
      uploader_kind: actor.kind,
      storage_path: storagePath,
      original_filename: filename,
      mime_type: data.mimeType,
      size_bytes: data.sizeBytes,
    });
    if (insertError) return { error: "Attachment upload could not be prepared." } as const;

    const signed = await db.storage
      .from(MESSAGE_ATTACHMENT_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: false });
    if (signed.error || !signed.data) {
      await db.from("social_bid_message_attachments").delete().eq("id", attachmentId);
      return { error: "Attachment upload could not be prepared." } as const;
    }
    return {
      attachmentId,
      path: signed.data.path,
      token: signed.data.token,
    } as const;
  });

const attachmentActionInput = conversationInput.extend({ attachmentId: z.string().uuid() });

export const cancelAttachmentUpload = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => attachmentActionInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to manage attachments." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { actor } = authorized;
    const { data: attachment } = await db
      .from("social_bid_message_attachments")
      .select("id, storage_path")
      .eq("id", data.attachmentId)
      .eq("conversation_id", data.conversationId)
      .eq("uploader_kind", actor.kind)
      .neq("status", "ready")
      .maybeSingle();
    if (!attachment) return { ok: true } as const;
    const removed = await db.storage
      .from(MESSAGE_ATTACHMENT_BUCKET)
      .remove([String(attachment.storage_path)]);
    if (removed.error && !/not found/i.test(removed.error.message))
      return { error: "Attachment could not be removed." } as const;
    const { error } = await db
      .from("social_bid_message_attachments")
      .delete()
      .eq("id", attachment.id);
    return error
      ? ({ error: "Attachment could not be removed." } as const)
      : ({ ok: true } as const);
  });

export const getAttachmentDownloadUrl = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => attachmentActionInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to open attachments." } as const;
    const { data: attachment } = await db
      .from("social_bid_message_attachments")
      .select("conversation_id, storage_path, original_filename, mime_type")
      .eq("id", data.attachmentId)
      .eq("status", "ready")
      .maybeSingle();
    if (!attachment || String(attachment.conversation_id) !== data.conversationId)
      return { error: "Attachment unavailable." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Attachment unavailable." } as const;
    const signed = await db.storage
      .from(MESSAGE_ATTACHMENT_BUCKET)
      .createSignedUrl(String(attachment.storage_path), 60, {
        download:
          attachment.mime_type === "application/pdf"
            ? safeFilename(String(attachment.original_filename))
            : false,
      });
    return signed.error || !signed.data
      ? ({ error: "Attachment could not be opened." } as const)
      : ({ url: signed.data.signedUrl } as const);
  });

const sendInput = conversationInput
  .extend({
    body: z.string().trim().max(2000),
    attachmentIds: z.array(z.string().uuid()).max(MAX_ATTACHMENTS_PER_MESSAGE),
    clientNonce: z.string().uuid(),
  })
  .refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
    message: "Write a message or attach a file.",
  })
  .refine((value) => new Set(value.attachmentIds).size === value.attachmentIds.length, {
    message: "Duplicate attachments are not allowed.",
  });

export const sendInboxMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => sendInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to send a message." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { conversation, actor } = authorized;
    if (conversation.blocked_by_creator_at || conversation.blocked_by_sponsor_at)
      return { error: "Messaging is blocked for this conversation." } as const;

    for (const attachmentId of data.attachmentIds) {
      const { data: attachment, error: attachmentError } = await db
        .from("social_bid_message_attachments")
        .select("id, storage_path, mime_type, size_bytes, status, expires_at")
        .eq("id", attachmentId)
        .eq("conversation_id", data.conversationId)
        .eq("uploader_kind", actor.kind)
        .is("message_id", null)
        .maybeSingle();
      if (
        attachmentError ||
        !attachment ||
        !["pending", "verified"].includes(String(attachment.status)) ||
        Date.parse(String(attachment.expires_at)) <= Date.now()
      )
        return {
          error: "An attachment expired or is unavailable. Please attach it again.",
        } as const;
      if (attachment.status === "verified") continue;
      const downloaded = await db.storage
        .from(MESSAGE_ATTACHMENT_BUCKET)
        .download(String(attachment.storage_path));
      if (downloaded.error || !downloaded.data)
        return { error: "An attachment did not finish uploading. Please try again." } as const;
      const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
      const detectedType = detectAttachmentType(bytes);
      if (
        !detectedType ||
        detectedType !== attachment.mime_type ||
        bytes.byteLength !== Number(attachment.size_bytes) ||
        bytes.byteLength > MAX_ATTACHMENT_BYTES
      ) {
        await db.storage.from(MESSAGE_ATTACHMENT_BUCKET).remove([String(attachment.storage_path)]);
        await db.from("social_bid_message_attachments").delete().eq("id", attachment.id);
        return { error: "An attachment's contents did not match its allowed file type." } as const;
      }
      const { error: verifyError } = await db
        .from("social_bid_message_attachments")
        .update({ status: "verified", verified_at: new Date().toISOString() })
        .eq("id", attachment.id)
        .eq("status", "pending");
      if (verifyError) return { error: "An attachment could not be verified." } as const;
    }

    const { data: message, error } = await db
      .rpc("social_bid_send_message_with_attachments", {
        p_conversation_id: data.conversationId,
        p_sender_kind: actor.kind,
        p_body: data.body.trim(),
        p_attachment_ids: data.attachmentIds,
        p_client_nonce: data.clientNonce,
      })
      .single();
    if (error || !message) return { error: "Message could not be sent." } as const;
    const sent = message as {
      id: string;
      sender_kind: MessagingActorKind;
      body: string;
      created_at: string;
    };
    return {
      message: {
        id: String(sent.id),
        senderKind: sent.sender_kind,
        body: String(sent.body),
        createdAt: String(sent.created_at),
        attachments: [],
      } as InboxMessage,
    } as const;
  });

const blockInput = conversationInput.extend({ blocked: z.boolean() });

export const setConversationBlocked = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => blockInput.parse(input))
  .handler(async ({ data }) => {
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to manage this conversation." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { actor } = authorized;
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
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to report this conversation." } as const;
    const authorized = await authorizedConversation(
      db,
      access,
      data.conversationId,
      data.actorKind,
    );
    if (!authorized) return { error: "Conversation unavailable." } as const;
    const { actor } = authorized;
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
    const { db, access } = await resolveAccess(data.token);
    if (!access) return { error: "Sign in to manage notifications." } as const;
    let actors = [...access.creators, ...access.sponsors];
    if (data.notificationId) {
      const notification = await db
        .from("social_bid_notifications")
        .select("creator_id, buyer_id")
        .eq("id", data.notificationId)
        .maybeSingle();
      const notificationRow = notification.data;
      if (!notificationRow) return { error: "Notification unavailable." } as const;
      actors = actors.filter((actor) =>
        actor.kind === "creator"
          ? actor.id === notificationRow.creator_id
          : actor.id === notificationRow.buyer_id,
      );
    } else if (data.actorKind) {
      actors = actors.filter((actor) => actor.kind === data.actorKind);
    }
    if (!actors.length) return { error: "Sign in to manage notifications." } as const;
    for (const actor of actors) {
      const column = actor.kind === "creator" ? "creator_id" : "buyer_id";
      let query = db
        .from("social_bid_notifications")
        .update({ read_at: new Date().toISOString() })
        .eq(column, actor.id);
      if (data.notificationId) query = query.eq("id", data.notificationId);
      const { error } = await query;
      if (error) return { error: "Notification could not be updated." } as const;
    }
    return { ok: true } as const;
  });
