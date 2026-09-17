import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/0027_secure_social_bid_creator_sessions.sql", import.meta.url),
  "utf8",
);
const sessionServer = readFileSync(
  new URL("../src/lib/creator-session.server.ts", import.meta.url),
  "utf8",
);
const callback = readFileSync(
  new URL("../src/routes/api/public/x-callback.ts", import.meta.url),
  "utf8",
);
const checkout = readFileSync(new URL("../src/lib/checkout.functions.ts", import.meta.url), "utf8");
const account = readFileSync(new URL("../src/lib/account.server.ts", import.meta.url), "utf8");
const rootRoute = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const authRoute = readFileSync(new URL("../src/routes/auth.tsx", import.meta.url), "utf8");
const sessionBootstrap = readFileSync(
  new URL("../src/lib/session-bootstrap.functions.ts", import.meta.url),
  "utf8",
);

const sourceFiles = [
  "creator.functions.ts",
  "payouts.functions.ts",
  "inbox.functions.ts",
  "checkout.functions.ts",
].map((name) => readFileSync(new URL(`../src/lib/${name}`, import.meta.url), "utf8"));

test("public creator access is allowlisted and excludes every private identity field", () => {
  assert.match(
    migration,
    /revoke all privileges on table public\.creators from public, anon, authenticated/,
  );
  const grant = migration.match(/grant select \(([\s\S]*?)\) on public\.creators/)?.[1] ?? "";
  for (const privateColumn of [
    "session_token",
    "user_id",
    "x_user_id",
    "social_account_id",
    "stripe_account_id",
    "stripe_connect_account_id",
    "verification_failure_count",
  ]) {
    assert.doesNotMatch(grant, new RegExp(`\\b${privateColumn}\\b`));
  }
  assert.match(migration, /drop policy if exists "creator updates own" on public\.creators/);
});

test("session table is RLS-protected and service-role only", () => {
  assert.match(migration, /create table if not exists public\.social_bid_user_sessions/);
  assert.match(migration, /alter table public\.social_bid_user_sessions enable row level security/);
  assert.match(
    migration,
    /revoke all privileges on table public\.social_bid_user_sessions[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant all privileges on table public\.social_bid_user_sessions to service_role/,
  );
});

test("raw session credentials are hashed before storage", () => {
  assert.match(sessionServer, /crypto\.getRandomValues\(new Uint8Array\(32\)\)/);
  assert.match(sessionServer, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(sessionServer, /token_hash: tokenHash/);
  assert.doesNotMatch(sessionServer, /token_hash: token[,\s}]/);
  assert.match(sessionServer, /HttpOnly; Secure; SameSite=Lax/);
});

test("expired, revoked, random and legacy tokens fail closed", () => {
  assert.match(sessionServer, /\.eq\("token_hash", tokenHash\)/);
  assert.match(sessionServer, /\.is\("revoked_at", null\)/);
  assert.match(sessionServer, /\.gt\("expires_at", new Date\(\)\.toISOString\(\)\)/);
  assert.match(migration, /update public\.creators[\s\S]*set session_token = null/);
  assert.match(
    migration,
    /constraint social_bid_legacy_session_token_disabled[\s\S]*check \(session_token is null\)/,
  );
  for (const source of sourceFiles) assert.doesNotMatch(source, /\.eq\("session_token"/);
});

test("X callback issues only the new user-backed session", () => {
  assert.match(callback, /issueCreatorSession\(db, userId\)/);
  assert.match(callback, /"Set-Cookie": sessionCookie/);
  assert.doesNotMatch(callback, /session_token/);
});

test("creator actions derive ownership from the canonical user id", () => {
  for (const source of sourceFiles) assert.doesNotMatch(source, /\.eq\("session_token"/);
  assert.match(account, /resolveCreatorSession/);
  assert.match(checkout, /resolveCanonicalAccount/);
  assert.doesNotMatch(checkout, /creatorToken/);
});

test("disconnect revokes server sessions and clears the browser credential", () => {
  const creatorFunctions = sourceFiles[0];
  assert.match(creatorFunctions, /revokeCreatorSessions\(db, session\.userId\)/);
  assert.match(creatorFunctions, /clearCreatorSessionCookie\(\)/);
  assert.match(sessionServer, /Max-Age=0/);
});

test("authenticated header controls require the secure creator session", () => {
  assert.match(rootRoute, /const inboxAvailable = creatorAuthenticated === true/);
  assert.doesNotMatch(rootRoute, /inboxAvailable =[^;]*messaging\?\.available/);
  assert.match(rootRoute, /getCreatorAuthState\(\{ data: \{\} \}\)/);
  assert.doesNotMatch(rootRoute, /\n    refreshCreatorSession\(\);/);
});

test("email auth establishes the existing server-readable Social Bid session before redirect", () => {
  assert.match(authRoute, /establishCanonicalSession/);
  assert.match(authRoute, /data: \{ accessToken \}/);
  assert.match(authRoute, /finish\(data\.session\.access_token\)/);
  assert.match(authRoute, /await establishCanonicalSession/);
  assert.match(authRoute, /window\.location\.assign\(next\)/);
  assert.match(sessionBootstrap, /db\.auth\.getUser\(data\.accessToken\)/);
  assert.match(sessionBootstrap, /issueCreatorSession\(db, user\.id\)/);
  assert.match(sessionBootstrap, /setResponseHeader\("Set-Cookie", cookie\)/);
  assert.doesNotMatch(sessionBootstrap, /localStorage/);
});
