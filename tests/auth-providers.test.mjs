import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const auth = read("src/routes/auth.tsx");
const magicLink = read("src/lib/magic-link.functions.ts");
const xStart = read("src/routes/api/public/x-start.ts");
const xCallback = read("src/routes/api/public/x-callback.ts");
const home = read("src/components/MarketplaceLeaderboard.tsx");
const migration = read("db/0030_social_bid_passwordless_auth.sql");
const inboxShell = read("src/components/MessagingShell.tsx");
const accountLinking = read("src/lib/account-linking.functions.ts");
const emailLinkCallback = read("src/routes/api/public/link-email.ts");
const identityLinkMigration = read("db/0031_social_bid_identity_linking.sql");
const canonicalMigration = read("db/0033_social_bid_canonical_account_resolution.sql");
const sessionBootstrap = read("src/lib/session-bootstrap.functions.ts");
const creator = read("src/routes/creator.tsx");

test("generic sign-in offers only X, Google and passwordless email", () => {
  assert.match(auth, /Continue with X/);
  assert.match(auth, /provider: "google"/);
  assert.match(auth, /Email me a sign-in link/);
  assert.match(auth, /verifyOtp/);
  assert.doesNotMatch(auth, /type="password"|signInWithPassword|auth\.signUp/);
});

test("all successful providers establish the same canonical first-party session", () => {
  assert.match(auth, /async function finish\(accessToken: string\)/);
  assert.match(auth, /establishCanonicalSession/);
  assert.match(auth, /onAuthStateChange/);
  assert.match(auth, /window\.location\.assign\(next\)/);
  assert.match(inboxShell, /Use X, Google, or email to open the same Inbox/);
});

test("redirect destinations are allowlisted rather than client-arbitrary", () => {
  assert.match(auth, /z\.enum\(\["\/admin", "\/creator", "\/inbox", "\/notifications"\]\)/);
  assert.match(xStart, /safeXOAuthNext/);
  assert.match(xCallback, /oauthState\.next/);
});

test("X linking carries only the verified canonical session through server-side OAuth state", () => {
  assert.match(xStart, /resolveCreatorSession\(db\)/);
  assert.match(xStart, /linkUserId: currentSession\?\.userId \?\? null/);
  assert.match(
    xCallback,
    /existing\?\.user_id && String\(existing\.user_id\) !== oauthState\.linkUserId/,
  );
  assert.match(xCallback, /\.update\(\{ user_id: oauthState\.linkUserId \}\)/);
  assert.match(xCallback, /x_account_conflict/);
  assert.doesNotMatch(xCallback, /buyer.*name|company.*merge|email.*merge/i);
});

test("homepage creator CTA remains a direct X OAuth entry", () => {
  assert.match(home, /\/api\/public\/x-start/);
  assert.doesNotMatch(home, /to="\/auth"/);
});

test("passwordless request throttling is SocialBid-only and service-role-only", () => {
  assert.match(magicLink, /reserve_social_bid_auth_email/);
  assert.match(magicLink, /auth\.admin\.generateLink/);
  assert.match(magicLink, /sendMagicLinkEmail/);
  assert.match(migration, /interval '60 seconds'/);
  assert.match(migration, /revoke all privileges[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*to service_role/);
});

test("explicit Google linking proves both sides without moving an Auth identity", () => {
  assert.match(accountLinking, /resolveCreatorSession/);
  assert.match(accountLinking, /social_bid_account_link_intents/);
  assert.match(accountLinking, /complete_social_bid_account_link/);
  assert.match(creator, /link_token/);
  assert.match(creator, /signInWithOAuth/);
  assert.doesNotMatch(creator, /auth\.linkIdentity/);
  assert.match(creator, /new URL\("\/auth", window\.location\.origin\)/);
  assert.match(creator, /redirect\.searchParams\.set\("next", "\/creator"\)/);
  assert.match(auth, /completeCanonicalAccountLink/);
  assert.match(auth, /google_link/);
  assert.match(auth, /reportCanonicalLinkCallbackFailure/);
  assert.match(auth, /window\.location\.hash/);
  assert.match(auth, /window\.location\.assign\(linkFailureDestination/);
  assert.doesNotMatch(accountLinking, /display_name|company_name|social_handle/);
});

test("email sign-in linking requires mailbox proof bound to the current session", () => {
  assert.match(accountLinking, /createLinkIntent\(current, "email"/);
  assert.match(accountLinking, /email_confirmed_at/);
  assert.match(accountLinking, /emailHash !== intent\.email_hash/);
  assert.match(accountLinking, /sendSignInMethodLinkEmail/);
  assert.match(auth, /token_hash/);
  assert.match(auth, /linkToken/);
  assert.doesNotMatch(emailLinkCallback, /updateUserById|social_bid_email_identity_links/);
  assert.match(identityLinkMigration, /id <> p_user_id/);
  assert.match(identityLinkMigration, /revoke all privileges[\s\S]*public, anon, authenticated/);
  assert.match(canonicalMigration, /grant execute[\s\S]*service_role/);
});

test("normal Google and email login resolve through the canonical mapping", () => {
  assert.match(sessionBootstrap, /resolveSocialBidAccountId/);
  assert.match(sessionBootstrap, /createIfMissing: true/);
  assert.match(canonicalMigration, /on conflict \(auth_user_id\) do nothing/);
});

test("link intents are provider-bound, session-bound, expiring and single-use", () => {
  assert.match(canonicalMigration, /provider in \('google', 'email'\)/);
  assert.match(canonicalMigration, /v_intent\.session_id <> p_session_id/);
  assert.match(canonicalMigration, /v_intent\.expires_at <= now\(\)/);
  assert.match(canonicalMigration, /v_intent\.used_at is not null/);
  assert.match(canonicalMigration, /for update/);
  assert.match(canonicalMigration, /where id = v_intent\.id and used_at is null/);
  assert.match(accountLinking, /result !== "linked" && result !== "already_linked"/);
  assert.match(accountLinking, /issueCreatorSession\(db, session\.userId\)/);
});

test("normal Google login remains separate from explicit Connect Google", () => {
  assert.match(auth, /continueWithGoogle/);
  assert.match(auth, /linkToken\s*\?/);
  assert.match(auth, /establishCanonicalSession/);
  assert.doesNotMatch(auth, /prepareGoogleIdentityLink/);
  assert.match(creator, /prepareGoogleIdentityLink/);
});

test("a provider already mapped to any other SocialBid account is rejected", () => {
  assert.match(canonicalMigration, /v_existing_canonical <> v_intent\.canonical_user_id/);
  assert.match(canonicalMigration, /return 'conflict'/);
  assert.doesNotMatch(canonicalMigration, /set canonical_user_id = v_intent\.canonical_user_id/);
  assert.match(canonicalMigration, /where user_id = p_authenticated_user_id/);
});
