-- SOCIAL BID ONLY — retire publicly exposed creator session tokens.
-- Apply this migration immediately before deploying the matching application
-- code. Existing creators will need to reconnect X once to receive a new session.

create table if not exists public.social_bid_user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists social_bid_user_sessions_user_expiry_idx
  on public.social_bid_user_sessions (user_id, expires_at desc);

alter table public.social_bid_user_sessions enable row level security;
revoke all privileges on table public.social_bid_user_sessions
  from public, anon, authenticated;
grant all privileges on table public.social_bid_user_sessions to service_role;

-- One canonical X-backed auth user owns at most one creator identity. Production
-- was audited before this constraint: every linked creator has a distinct user_id.
create unique index if not exists social_bid_creators_user_id_unique
  on public.creators (user_id)
  where user_id is not null;

-- Remove broad creator-table privileges. RLS restricts rows, while these
-- explicit column grants restrict which fields the Data API can ever return.
-- Future columns stay private unless deliberately added to this list.
revoke all privileges on table public.creators from public, anon, authenticated;

-- Creator mutations now go through server functions that resolve the hashed
-- Social Bid session. Remove the obsolete direct-auth update path as defense
-- in depth so a future table grant cannot silently reactivate it.
drop policy if exists "creator updates own" on public.creators;

grant select (
  id,
  display_name,
  username,
  profile_image_url,
  bio,
  social_platform,
  social_handle,
  social_profile_url,
  follower_count,
  verification_status,
  banned,
  x_username,
  x_profile_image_url,
  x_profile_url,
  x_follower_count,
  x_account_verified,
  x_bio_verified,
  x_bio_snapshot
) on public.creators to anon, authenticated;

-- Every legacy credential was publicly readable and must be considered
-- compromised. Do not copy these values into the replacement session table.
update public.creators
set session_token = null
where session_token is not null;

-- Keep the legacy column for migration compatibility, but make credential
-- regression impossible even if older application code is accidentally run.
alter table public.creators
  drop constraint if exists social_bid_legacy_session_token_disabled;
alter table public.creators
  add constraint social_bid_legacy_session_token_disabled
  check (session_token is null);
