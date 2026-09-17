import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const redirect = read("src/lib/redirect.functions.ts");
const migration = read("db/0032_secure_social_bid_click_tracking.sql");

test("public redirect resolves authoritative click relationships server-side", () => {
  assert.match(redirect, /const \{ admin \} = await import\("\.\/db\.server"\)/);
  assert.match(redirect, /\.eq\("listing_id", listing\.id\)/);
  assert.match(redirect, /\.eq\("status", "active"\)/);
  assert.match(redirect, /db\.rpc\("record_click"/);
});

test("record_click is service-only and validates every supplied relationship", () => {
  assert.match(migration, /v_creator_id is distinct from _creator_id/);
  assert.match(migration, /o\.listing_id = _listing_id/);
  assert.match(migration, /o\.status = 'active'/);
  assert.match(migration, /o\.ended_at is null/);
  assert.match(migration, /revoke all on function[\s\S]*public, anon, authenticated/);
  assert.match(migration, /grant execute[\s\S]*service_role/);
});
