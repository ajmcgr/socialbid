import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../db/0028_social_bid_account_architecture.sql", import.meta.url),
  "utf8",
);
const account = readFileSync(new URL("../src/lib/account.server.ts", import.meta.url), "utf8");
const checkout = readFileSync(new URL("../src/lib/checkout.functions.ts", import.meta.url), "utf8");
const inbox = readFileSync(new URL("../src/lib/inbox.functions.ts", import.meta.url), "utf8");
const recovery = readFileSync(
  new URL("../src/lib/buyer-recovery.functions.ts", import.meta.url),
  "utf8",
);
const messagingHook = readFileSync(
  new URL("../src/hooks/useMessagingContext.ts", import.meta.url),
  "utf8",
);
const rootRoute = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const inboxRoute = readFileSync(new URL("../src/routes/inbox.tsx", import.meta.url), "utf8");
const notificationsRoute = readFileSync(
  new URL("../src/routes/notifications.tsx", import.meta.url),
  "utf8",
);

test("one canonical account can own multiple buyer identities", () => {
  assert.match(migration, /drop index if exists public\.social_bid_buyers_user_id_unique/);
  assert.match(migration, /create index if not exists social_bid_buyers_user_id_idx/);
  assert.doesNotMatch(migration, /unique index[^;]*buyers_user_id_idx/);
  assert.match(inbox, /\.eq\("user_id", account\.userId\)/);
  assert.match(inbox, /\.\.\.access\.sponsors/);
});

test("canonical credentials must resolve to the same auth user", () => {
  assert.match(account, /creatorSession\.userId !== authUser\.id/);
  assert.match(account, /Conflicting SocialBid account credentials/);
});

test("messaging uses the canonical server session without mixing browser credentials", () => {
  assert.doesNotMatch(messagingHook, /getSupabase|auth\.getSession/);
  assert.match(messagingHook, /const token = null/);
  assert.match(rootRoute, /getMessagingContext\(\{ data: \{ token: null \} \}\)/);
});

test("messaging error and initial loading states are mutually exclusive", () => {
  assert.match(messagingHook, /finally \{[\s\S]*setLoading\(false\)/);
  assert.match(inboxRoute, /loading && !context/);
  assert.match(notificationsRoute, /loading && !context/);
  assert.match(inboxRoute, /Try again/);
  assert.match(notificationsRoute, /Try again/);
});

test("authenticated checkout derives buyer ownership and payment principal server-side", () => {
  assert.match(checkout, /resolveCanonicalAccount\(db, data\.authToken\)/);
  assert.match(checkout, /user_id: account\?\.userId \?\? null/);
  assert.match(checkout, /initiated_by_user_id: account\?\.userId \?\? null/);
  assert.match(migration, /social_bid_payment_principal_immutable/);
  assert.doesNotMatch(checkout, /userId: data\./);
});

test("guest and historical claims are hashed, exact, expiring and service-only", () => {
  assert.match(migration, /payment_id uuid not null unique/);
  assert.match(migration, /buyer_id uuid not null/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /v_claim\.expires_at <= now\(\)/);
  assert.match(migration, /p\.status = 'applied'/);
  assert.match(
    migration,
    /revoke all on public\.social_bid_guest_buyer_claims from public, anon, authenticated/,
  );
  assert.match(migration, /revoke execute on function public\.claim_social_bid_historical_buyer/);
  assert.match(recovery, /If eligible sponsorships are associated/);
  assert.doesNotMatch(inbox, /\.update\(\{ user_id: user\.id \}\)/);
});
