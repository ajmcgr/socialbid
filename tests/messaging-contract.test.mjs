import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/0024_social_bid_messaging.sql", import.meta.url),
  "utf8",
);
const server = readFileSync(new URL("../src/lib/inbox.functions.ts", import.meta.url), "utf8");

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
  const messageInsert = server.indexOf('.from("social_bid_messages")\n      .insert');
  assert.ok(blockCheck >= 0);
  assert.ok(messageInsert > blockCheck);
});
