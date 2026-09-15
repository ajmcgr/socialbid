-- SOCIAL BID ONLY — canonical account ownership, multi-buyer support and
-- capability-based buyer recovery. Safe for the shared Post/Social Bid project.

-- One account may own multiple commercial buyer identities. Email remains
-- contact/recovery evidence, while company + email distinguishes identities.
drop index if exists public.social_bid_buyers_user_id_unique;
alter table public.buyers drop constraint if exists buyers_email_key;

create index if not exists social_bid_buyers_user_id_idx
  on public.buyers (user_id) where user_id is not null;
create unique index if not exists social_bid_owned_buyer_identity_unique
  on public.buyers (
    user_id,
    lower(btrim(email)),
    lower(btrim(coalesce(company_name, '')))
  ) where user_id is not null;
create unique index if not exists social_bid_guest_buyer_identity_unique
  on public.buyers (
    lower(btrim(email)),
    lower(btrim(coalesce(company_name, '')))
  ) where user_id is null;
create index if not exists social_bid_buyers_email_recovery_idx
  on public.buyers (lower(btrim(email)));

alter table public.payments
  add column if not exists initiated_by_user_id uuid references auth.users(id) on delete set null;
create index if not exists social_bid_payments_initiated_by_user_idx
  on public.payments (initiated_by_user_id, created_at desc)
  where initiated_by_user_id is not null;

create or replace function public.social_bid_keep_payment_principal_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The FK may clear the audit principal when an auth user is deleted. All
  -- other attempts to add, replace or restore the principal after insert fail.
  if new.initiated_by_user_id is distinct from old.initiated_by_user_id
     and new.initiated_by_user_id is not null then
    raise exception 'Social Bid payment principal is immutable';
  end if;
  return new;
end;
$$;
revoke execute on function public.social_bid_keep_payment_principal_immutable()
  from public, anon, authenticated;
grant execute on function public.social_bid_keep_payment_principal_immutable() to service_role;
drop trigger if exists social_bid_payment_principal_immutable on public.payments;
create trigger social_bid_payment_principal_immutable
before update of initiated_by_user_id on public.payments
for each row execute function public.social_bid_keep_payment_principal_immutable();

create table if not exists public.social_bid_guest_buyer_claims (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.payments(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((consumed_at is null and claimed_by_user_id is null)
    or (consumed_at is not null and claimed_by_user_id is not null))
);
create index if not exists social_bid_guest_claim_expiry_idx
  on public.social_bid_guest_buyer_claims (expires_at) where consumed_at is null;

create table if not exists public.social_bid_buyer_recovery_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  buyer_id uuid not null references public.buyers(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 10),
  created_at timestamptz not null default now()
);
create index if not exists social_bid_buyer_recovery_user_idx
  on public.social_bid_buyer_recovery_requests (user_id, created_at desc);
create index if not exists social_bid_buyer_recovery_expiry_idx
  on public.social_bid_buyer_recovery_requests (expires_at) where consumed_at is null;

revoke all on public.social_bid_guest_buyer_claims from public, anon, authenticated;
revoke all on public.social_bid_buyer_recovery_requests from public, anon, authenticated;
grant all on public.social_bid_guest_buyer_claims to service_role;
grant all on public.social_bid_buyer_recovery_requests to service_role;
alter table public.social_bid_guest_buyer_claims enable row level security;
alter table public.social_bid_buyer_recovery_requests enable row level security;

create or replace function public.claim_social_bid_guest_buyer(
  p_token_hash text,
  p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.social_bid_guest_buyer_claims%rowtype;
  v_owner uuid;
begin
  select * into v_claim
  from public.social_bid_guest_buyer_claims
  where token_hash = p_token_hash
  for update;
  if not found or v_claim.consumed_at is not null or v_claim.expires_at <= now() then
    return null;
  end if;
  if not exists (
    select 1 from public.payments p
    join public.ownerships o on o.payment_id = p.id and o.buyer_id = p.buyer_id
    where p.id = v_claim.payment_id and p.buyer_id = v_claim.buyer_id
      and p.status = 'applied'
  ) then
    return null;
  end if;
  select user_id into v_owner from public.buyers where id = v_claim.buyer_id for update;
  if v_owner is not null and v_owner <> p_user_id then return null; end if;
  update public.buyers set user_id = p_user_id
    where id = v_claim.buyer_id and (user_id is null or user_id = p_user_id);
  update public.social_bid_guest_buyer_claims
    set consumed_at = now(), claimed_by_user_id = p_user_id
    where id = v_claim.id;
  return v_claim.buyer_id;
end;
$$;

create or replace function public.claim_social_bid_historical_buyer(
  p_token_hash text,
  p_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim public.social_bid_buyer_recovery_requests%rowtype;
  v_owner uuid;
begin
  select * into v_claim
  from public.social_bid_buyer_recovery_requests
  where token_hash = p_token_hash and user_id = p_user_id
  for update;
  if not found or v_claim.consumed_at is not null or v_claim.expires_at <= now()
     or v_claim.attempt_count >= 10 then return null; end if;
  update public.social_bid_buyer_recovery_requests
    set attempt_count = attempt_count + 1 where id = v_claim.id;
  if not exists (
    select 1 from public.payments p
    join public.ownerships o on o.payment_id = p.id and o.buyer_id = p.buyer_id
    where p.buyer_id = v_claim.buyer_id and p.status = 'applied'
  ) then return null; end if;
  select user_id into v_owner from public.buyers where id = v_claim.buyer_id for update;
  if v_owner is not null and v_owner <> p_user_id then return null; end if;
  update public.buyers set user_id = p_user_id
    where id = v_claim.buyer_id and (user_id is null or user_id = p_user_id);
  update public.social_bid_buyer_recovery_requests
    set consumed_at = now() where id = v_claim.id;
  return v_claim.buyer_id;
end;
$$;

revoke execute on function public.claim_social_bid_guest_buyer(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.claim_social_bid_historical_buyer(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_social_bid_guest_buyer(text, uuid) to service_role;
grant execute on function public.claim_social_bid_historical_buyer(text, uuid) to service_role;
