import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/0035_social_bid_guest_claim_reconciliation.sql", import.meta.url),
  "utf8",
);

test("guest claim preserves capability and applied-payment validation", () => {
  assert.match(migration, /where token_hash = p_token_hash\s+for update/);
  assert.match(migration, /v_claim\.consumed_at is not null/);
  assert.match(migration, /v_claim\.expires_at <= now\(\)/);
  assert.match(migration, /p\.id = v_claim\.payment_id/);
  assert.match(migration, /p\.buyer_id = v_claim\.buyer_id/);
  assert.match(migration, /p\.status = 'applied'/);
  assert.match(migration, /o\.payment_id = p\.id/);
  assert.match(migration, /o\.buyer_id = p\.buyer_id/);
});

test("first-time guest claims remain the direct path", () => {
  assert.match(migration, /if v_existing_buyer_id is null then/);
  assert.match(migration, /set user_id = p_user_id/);
  assert.match(migration, /return v_guest_buyer\.id/);
});

test("collision reconciliation uses exact canonical buyer identity", () => {
  assert.match(migration, /b\.user_id = p_user_id/);
  assert.match(migration, /lower\(btrim\(b\.email\)\) = lower\(btrim\(v_guest_buyer\.email\)\)/);
  assert.match(migration, /lower\(btrim\(coalesce\(b\.company_name, ''\)\)\)/);
  assert.doesNotMatch(migration, /ilike/);
});

test("all live buyer foreign keys are repointed before alias deletion", () => {
  for (const table of [
    "payments",
    "ownerships",
    "social_bid_notifications",
    "social_bid_buyer_recovery_requests",
    "social_bid_guest_buyer_claims",
  ]) {
    assert.match(migration, new RegExp(`update public\\.${table}`));
  }
  assert.match(migration, /delete from public\.buyers/);
});

test("duplicate conversations preserve dependencies and state", () => {
  for (const table of [
    "social_bid_message_attachments",
    "social_bid_messages",
    "social_bid_notifications",
    "social_bid_conversation_reports",
  ]) {
    assert.match(migration, new RegExp(`update public\\.${table}`));
  }
  assert.match(migration, /creator_last_read_at = case/);
  assert.match(migration, /sponsor_last_read_at = case/);
  assert.match(migration, /creator_marked_unread_at = greatest/);
  assert.match(migration, /sponsor_marked_unread_at = greatest/);
  assert.match(migration, /blocked_by_creator_at = case/);
  assert.match(migration, /blocked_by_sponsor_at = case/);
  assert.match(migration, /delete from public\.social_bid_conversations/);
});

test("claim mutation remains service-role only", () => {
  assert.match(
    migration,
    /revoke all on function public\.claim_social_bid_guest_buyer\(text, uuid\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.claim_social_bid_guest_buyer\(text, uuid\)[\s\S]*to service_role/,
  );
});
