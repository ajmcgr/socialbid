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

test("explicit Google linking bootstraps the exact existing canonical user", () => {
  assert.match(accountLinking, /resolveCreatorSession/);
  assert.match(accountLinking, /auth\.admin\.getUserById\(session\.userId\)/);
  assert.match(accountLinking, /type: "magiclink"/);
  assert.match(auth, /signInWithOAuth/);
  assert.match(read("src/routes/creator.tsx"), /auth\.linkIdentity\(\{/);
  assert.doesNotMatch(accountLinking, /display_name|company_name|social_handle/);
});

test("email sign-in linking requires mailbox proof bound to the current session", () => {
  assert.match(accountLinking, /reserve_social_bid_email_identity_link/);
  assert.match(accountLinking, /sendSignInMethodLinkEmail/);
  assert.match(emailLinkCallback, /resolveCreatorSession/);
  assert.match(emailLinkCallback, /\.eq\("user_id", session\.userId\)/);
  assert.match(emailLinkCallback, /auth\.admin\.updateUserById\(session\.userId/);
  assert.match(identityLinkMigration, /id <> p_user_id/);
  assert.match(identityLinkMigration, /return 'conflict'/);
  assert.match(identityLinkMigration, /revoke all privileges[\s\S]*public, anon, authenticated/);
  assert.match(identityLinkMigration, /grant execute[\s\S]*service_role/);
});
