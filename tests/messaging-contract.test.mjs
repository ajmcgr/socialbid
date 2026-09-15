import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/0024_social_bid_messaging.sql", import.meta.url),
  "utf8",
);
const unreadMigration = readFileSync(
  new URL("../db/0025_social_bid_manual_unread.sql", import.meta.url),
  "utf8",
);
const attachmentMigration = readFileSync(
  new URL("../db/0026_social_bid_message_attachments.sql", import.meta.url),
  "utf8",
);
const server = readFileSync(new URL("../src/lib/inbox.functions.ts", import.meta.url), "utf8");
const inboxRoute = readFileSync(new URL("../src/routes/inbox.tsx", import.meta.url), "utf8");
const messagingShell = readFileSync(
  new URL("../src/components/MessagingShell.tsx", import.meta.url),
  "utf8",
);

test("one permanent conversation is enforced per creator and sponsor", () => {
  assert.match(migration, /unique \(creator_id, buyer_id\)/);
  assert.match(migration, /on conflict \(creator_id, buyer_id\) do update/);
});

test("messaging entitlement requires applied payment and matching ownership", () => {
  assert.match(server, /\.eq\("status", "applied"\)/);
  assert.match(server, /\.eq\("payment_id", payment\.id\)/);
  assert.match(server, /\.eq\("buyer_id", buyerId\)/);
  assert.match(migration, /join public\.ownerships o on o\.payment_id = p\.id/);
  assert.match(migration, /where p\.status = 'applied'/);
});

test("messaging tables are not directly accessible to public clients", () => {
  for (const table of [
    "social_bid_conversations",
    "social_bid_messages",
    "social_bid_notifications",
    "social_bid_conversation_reports",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`),
    );
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
});

test("blocking is enforced before message insertion", () => {
  const blockCheck = server.indexOf("conversation.blocked_by_creator_at");
  const messageInsert = server.indexOf('.rpc("social_bid_send_message_with_attachments"');
  assert.ok(blockCheck >= 0);
  assert.ok(messageInsert > blockCheck);
});

test("creator and sponsor conversations are merged and deduplicated by conversation id", () => {
  assert.match(server, /const actors = \[creator, sponsor\]\.filter\(Boolean\)/);
  assert.match(server, /const conversationMap = new Map<string, InboxConversation>\(\)/);
  assert.match(server, /if \(conversationMap\.has\(conversationId\)\) continue/);
  assert.match(server, /conversationMap\.set\(conversationId, loaded\)/);
});

test("unified inbox preserves actor authorization and sorts by latest activity", () => {
  assert.match(server, /actorKind: actor\.kind/);
  assert.match(server, /Date\.parse\(b\.lastActivityAt\) - Date\.parse\(a\.lastActivityAt\)/);
  assert.match(inboxRoute, /actorKind = selected\?\.actorKind/);
  assert.match(server, /unreadCount: effectiveUnreadCount/);
});

test("inbox has no creator or sponsor role tabs and explains relationship direction", () => {
  assert.doesNotMatch(inboxRoute, /RoleSwitcher/);
  assert.doesNotMatch(messagingShell, /Creator inbox|Sponsor inbox/);
  assert.match(server, /sponsor · Sponsored you/);
  assert.match(server, /sponsor them · Current/);
  assert.match(server, /sponsored them · Previous/);
});

test("manual unread state is participant-specific and contributes to existing unread counts", () => {
  assert.match(unreadMigration, /creator_marked_unread_at timestamptz/);
  assert.match(unreadMigration, /sponsor_marked_unread_at timestamptz/);
  assert.match(server, /actor\.kind === "creator"[\s\S]*creator_marked_unread_at/);
  assert.match(server, /Math\.max\(unreadCount \?\? 0, manuallyUnread \? 1 : 0\)/);
});

test("manual read-state mutation remains server-authorized and does not change activity", () => {
  const start = server.indexOf("export const setConversationReadState");
  const end = server.indexOf("const sendInput", start);
  const action = server.slice(start, end);
  assert.match(action, /authorizedConversation\(db, actor, data\.conversationId\)/);
  assert.match(action, /creator_marked_unread_at/);
  assert.match(action, /sponsor_marked_unread_at/);
  assert.doesNotMatch(action, /updated_at|social_bid_notifications|sendEmail|Resend/);
});

test("opening a conversation clears only the current actor's manual unread flag", () => {
  assert.match(
    server,
    /actor\.kind === "creator" \? "creator_marked_unread_at" : "sponsor_marked_unread_at"/,
  );
  assert.match(
    server,
    /update\(\{ \[readColumn\]: new Date\(\)\.toISOString\(\), \[markedUnreadColumn\]: null \}\)/,
  );
});

test("attachments use a dedicated private bucket and service-role-only metadata", () => {
  assert.match(
    attachmentMigration,
    /'social-bid-message-attachments',[\s\S]*false,[\s\S]*10485760/,
  );
  assert.match(
    attachmentMigration,
    /revoke all on public\.social_bid_message_attachments from public, anon, authenticated/,
  );
  assert.match(
    attachmentMigration,
    /alter table public\.social_bid_message_attachments enable row level security/,
  );
  assert.doesNotMatch(server, /getPublicUrl\(/);
});

test("attachment upload and download require existing conversation authorization", () => {
  for (const functionName of [
    "createAttachmentUpload",
    "cancelAttachmentUpload",
    "getAttachmentDownloadUrl",
  ]) {
    const start = server.indexOf(`export const ${functionName}`);
    const next = server.indexOf("export const ", start + 20);
    const body = server.slice(start, next < 0 ? undefined : next);
    assert.match(body, /authorizedConversation\(db, actor, data\.conversationId\)/);
  }
});

test("attachments are byte-validated and atomically claimed with one message", () => {
  assert.match(server, /function detectAttachmentType/);
  assert.match(server, /bytes\.byteLength !== Number\(attachment\.size_bytes\)/);
  assert.match(server, /detectedType !== attachment\.mime_type/);
  assert.match(attachmentMigration, /v_attachment_count > 5/);
  assert.match(attachmentMigration, /status = 'verified'/);
  assert.match(attachmentMigration, /set message_id = v_message\.id,[\s\S]*status = 'ready'/);
  assert.match(attachmentMigration, /p_client_nonce uuid/);
});

test("composer supports image/PDF attachment-only messages without changing unread logic", () => {
  assert.match(inboxRoute, /accept="image\/jpeg,image\/png,image\/webp,application\/pdf"/);
  assert.match(inboxRoute, /if \(!body && !selectedAttachments\.length\) return/);
  assert.match(inboxRoute, /uploadToSignedUrl/);
  assert.match(attachmentMigration, /when new\.has_attachments then 'Sent an attachment\.'/);
  assert.match(migration, /after insert on public\.social_bid_messages/);
});
