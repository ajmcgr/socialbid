import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("db/0034_social_bid_empty_bootstrap_link.sql");
const canonicalMigration = read("db/0033_social_bid_canonical_account_resolution.sql");
const auth = read("src/routes/auth.tsx");
const creator = read("src/routes/creator.tsx");
const sessionBootstrap = read("src/lib/session-bootstrap.functions.ts");

test("only an empty bootstrap self-map can be reassigned", () => {
  assert.match(migration, /v_existing_canonical <> p_authenticated_user_id/);
  assert.match(migration, /canonical_user_id = p_authenticated_user_id/);
  assert.match(migration, /canonical_user_id = v_intent\.canonical_user_id/);
  assert.match(migration, /if not v_empty_bootstrap then\s+return 'conflict'/);
  assert.match(
    migration,
    /where auth_user_id = p_authenticated_user_id\s+and canonical_user_id = p_authenticated_user_id/,
  );
});

test("creator, buyer and initiated-payment ownership each block reassignment", () => {
  assert.match(migration, /from public\.creators c\s+where c\.user_id = p_authenticated_user_id/);
  assert.match(migration, /from public\.buyers b\s+where b\.user_id = p_authenticated_user_id/);
  assert.match(
    migration,
    /from public\.payments p\s+where p\.initiated_by_user_id = p_authenticated_user_id/,
  );
  assert.match(migration, /from public\.listings l[\s\S]*c\.user_id = p_authenticated_user_id/);
  assert.match(migration, /from public\.ownerships o[\s\S]*b\.user_id = p_authenticated_user_id/);
});

test("conversation, message and notification ownership each block reassignment", () => {
  assert.match(migration, /from public\.social_bid_conversations conversation/);
  assert.match(migration, /from public\.social_bid_messages message/);
  assert.match(migration, /from public\.social_bid_notifications notification/);
  assert.match(migration, /conversation\.creator_id/);
  assert.match(migration, /conversation\.buyer_id/);
});

test("all remaining direct SocialBid account state blocks reassignment", () => {
  assert.match(migration, /from public\.user_roles r\s+where r\.user_id = p_authenticated_user_id/);
  assert.match(migration, /from public\.social_bid_buyer_recovery_requests r/);
  assert.match(migration, /r\.previous_user_id = p_authenticated_user_id/);
  assert.match(migration, /from public\.social_bid_email_identity_links e/);
  assert.match(migration, /from public\.social_bid_guest_buyer_claims g/);
  assert.match(migration, /g\.claimed_by_user_id = p_authenticated_user_id/);
  assert.match(migration, /from public\.social_bid_user_sessions s/);
  assert.match(migration, /s\.revoked_at is null/);
  assert.match(migration, /s\.expires_at > now\(\)/);
});

test("another Auth user mapped to the bootstrap canonical account blocks reassignment", () => {
  assert.match(migration, /m\.canonical_user_id = p_authenticated_user_id/);
  assert.match(migration, /m\.auth_user_id <> p_authenticated_user_id/);
});

test("established mappings to another canonical account remain conflicts", () => {
  assert.match(migration, /v_existing_canonical <> v_intent\.canonical_user_id/);
  assert.match(
    migration,
    /v_existing_canonical <> p_authenticated_user_id[\s\S]*return 'conflict'/,
  );
});

test("forged, expired, used and wrong-session intents are rejected", () => {
  assert.match(migration, /p_token_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(migration, /where token_hash = p_token_hash\s+for update/);
  assert.match(migration, /v_intent\.used_at is not null/);
  assert.match(migration, /v_intent\.expires_at <= now\(\)/);
  assert.match(migration, /v_intent\.session_id <> p_session_id/);
  assert.match(migration, /s\.user_id = v_intent\.canonical_user_id/);
});

test("mapping and intent consumption are atomic and concurrent links serialize", () => {
  assert.match(migration, /lock table[\s\S]*in share row exclusive mode/);
  assert.match(migration, /where auth_user_id = p_authenticated_user_id\s+for update/);
  assert.match(migration, /where id = v_intent\.id and used_at is null/);
  assert.match(migration, /social_bid_account_link_intent_consume_failed/);
  assert.match(migration, /raise exception/);
  assert.ok(
    migration.indexOf("set canonical_user_id = v_intent.canonical_user_id") <
      migration.indexOf("set used_at = now(), linked_auth_user_id = p_authenticated_user_id"),
  );
});

test("normal Google sign-in remains bootstrap-only and cannot reassign an account", () => {
  assert.match(sessionBootstrap, /resolveSocialBidAccountId/);
  assert.match(sessionBootstrap, /createIfMissing: true/);
  assert.match(canonicalMigration, /ensure_social_bid_account/);
  assert.match(canonicalMigration, /on conflict \(auth_user_id\) do nothing/);
  assert.doesNotMatch(sessionBootstrap, /complete_social_bid_account_link/);
  assert.doesNotMatch(sessionBootstrap, /set canonical_user_id/);
});

test("the migration is SocialBid-only and leaves Post-owned tables untouched", () => {
  assert.doesNotMatch(
    migration,
    /public\.(profiles|posts|oauth_connections|oauth_states|subscriptions|workspaces|workspace_members|queue_settings|stripe_webhook_events)/,
  );
  assert.match(migration, /revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
});

test("Google callbacks use a dedicated processing and visible outcome UI", () => {
  assert.match(auth, /const googleLinkMode = Boolean\(linkToken && type !== "magiclink"\)/);
  assert.match(auth, /Connecting Google…/);
  assert.match(auth, /googleLinkMode \? "\/creator\?google_link=success" : next/);
  assert.match(auth, /link_error/);
  assert.match(creator, /Google — Connected/);
  assert.match(creator, /Google couldn't be connected\. Please try again\./);
  assert.doesNotMatch(auth, /auth\.linkIdentity/);
});
