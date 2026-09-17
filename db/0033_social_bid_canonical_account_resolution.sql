-- SOCIALBID ONLY — allow multiple independently proven Supabase Auth users to
-- resolve to one existing SocialBid ownership principal without moving or
-- modifying any shared Auth identity (including identities used by Post).

create table if not exists public.social_bid_account_auth_users (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  canonical_user_id uuid not null references auth.users(id) on delete cascade,
  linked_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists social_bid_account_auth_users_canonical_idx
  on public.social_bid_account_auth_users (canonical_user_id);

alter table public.social_bid_account_auth_users enable row level security;
revoke all privileges on table public.social_bid_account_auth_users
  from public, anon, authenticated;
grant all privileges on table public.social_bid_account_auth_users to service_role;

create table if not exists public.social_bid_account_link_intents (
  id uuid primary key default gen_random_uuid(),
  canonical_user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.social_bid_user_sessions(id) on delete cascade,
  provider text not null check (provider in ('google', 'email')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  email_hash text check (email_hash is null or email_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  linked_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((provider = 'email' and email_hash is not null)
      or (provider = 'google' and email_hash is null))
);

create index if not exists social_bid_account_link_intents_account_created_idx
  on public.social_bid_account_link_intents (canonical_user_id, created_at desc);

alter table public.social_bid_account_link_intents enable row level security;
revoke all privileges on table public.social_bid_account_link_intents
  from public, anon, authenticated;
grant all privileges on table public.social_bid_account_link_intents to service_role;

-- Existing SocialBid ownership principals become self-mapped canonical roots.
-- This is identity-preserving: no creator, buyer, payment, session or
-- conversation ownership column is rewritten.
insert into public.social_bid_account_auth_users (auth_user_id, canonical_user_id)
select candidate.user_id, candidate.user_id
from (
  select user_id from public.creators where user_id is not null
  union
  select user_id from public.buyers where user_id is not null
  union
  select initiated_by_user_id from public.payments where initiated_by_user_id is not null
) candidate
join auth.users auth_user on auth_user.id = candidate.user_id
on conflict (auth_user_id) do nothing;

create or replace function public.ensure_social_bid_account(
  p_auth_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_canonical_user_id uuid;
begin
  if p_auth_user_id is null
     or not exists (select 1 from auth.users where id = p_auth_user_id) then
    return null;
  end if;

  insert into public.social_bid_account_auth_users (
    auth_user_id, canonical_user_id
  ) values (
    p_auth_user_id, p_auth_user_id
  ) on conflict (auth_user_id) do nothing;

  select canonical_user_id into v_canonical_user_id
  from public.social_bid_account_auth_users
  where auth_user_id = p_auth_user_id;

  return v_canonical_user_id;
end;
$$;

revoke all on function public.ensure_social_bid_account(uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_social_bid_account(uuid)
  to service_role;

create or replace function public.resolve_social_bid_account(
  p_auth_user_id uuid
) returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select canonical_user_id
  from public.social_bid_account_auth_users
  where auth_user_id = p_auth_user_id
$$;

revoke all on function public.resolve_social_bid_account(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_social_bid_account(uuid)
  to service_role;

-- Atomically consumes a proof-bound intent and adds the authenticated Auth
-- user to the intended SocialBid account. Provider/mailbox proof is verified
-- by server code before this service-role-only function is called.
create or replace function public.complete_social_bid_account_link(
  p_token_hash text,
  p_authenticated_user_id uuid,
  p_session_id uuid,
  p_provider text,
  p_email_hash text default null
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_intent public.social_bid_account_link_intents%rowtype;
  v_existing_canonical uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$'
     or p_authenticated_user_id is null
     or p_session_id is null
     or p_provider not in ('google', 'email')
     or not exists (select 1 from auth.users where id = p_authenticated_user_id) then
    return 'invalid';
  end if;

  select * into v_intent
  from public.social_bid_account_link_intents
  where token_hash = p_token_hash
  for update;

  if not found
     or v_intent.used_at is not null
     or v_intent.expires_at <= now()
     or v_intent.session_id <> p_session_id
     or v_intent.provider <> p_provider
     or (v_intent.provider = 'email' and v_intent.email_hash is distinct from p_email_hash)
     or not exists (
       select 1 from public.social_bid_user_sessions s
       where s.id = p_session_id
         and s.user_id = v_intent.canonical_user_id
         and s.revoked_at is null
         and s.expires_at > now()
     ) then
    return 'invalid';
  end if;

  select canonical_user_id into v_existing_canonical
  from public.social_bid_account_auth_users
  where auth_user_id = p_authenticated_user_id;

  if v_existing_canonical is not null
     and v_existing_canonical <> v_intent.canonical_user_id then
    return 'conflict';
  end if;

  insert into public.social_bid_account_auth_users (
    auth_user_id, canonical_user_id, linked_provider
  ) values (
    p_authenticated_user_id, v_intent.canonical_user_id, p_provider
  )
  on conflict (auth_user_id) do update
    set updated_at = now(),
        linked_provider = coalesce(
          public.social_bid_account_auth_users.linked_provider,
          excluded.linked_provider
        )
    where public.social_bid_account_auth_users.canonical_user_id = excluded.canonical_user_id;

  -- Close the concurrent-link race: if another account mapped this Auth user
  -- first, the conditional upsert above changes no row and this attempt fails.
  select canonical_user_id into v_existing_canonical
  from public.social_bid_account_auth_users
  where auth_user_id = p_authenticated_user_id;
  if v_existing_canonical is distinct from v_intent.canonical_user_id then
    return 'conflict';
  end if;

  -- A pre-mapping login may have created an empty first-party session for this
  -- Auth user. Revoke it so every future session is issued through the new
  -- canonical mapping. The current canonical session is preserved.
  if p_authenticated_user_id <> v_intent.canonical_user_id then
    update public.social_bid_user_sessions
    set revoked_at = coalesce(revoked_at, now())
    where user_id = p_authenticated_user_id
      and id <> p_session_id
      and revoked_at is null;
  end if;

  update public.social_bid_account_link_intents
  set used_at = now(), linked_auth_user_id = p_authenticated_user_id
  where id = v_intent.id and used_at is null;

  if not found then return 'invalid'; end if;
  return 'linked';
end;
$$;

revoke all on function public.complete_social_bid_account_link(text, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_social_bid_account_link(text, uuid, uuid, text, text)
  to service_role;

-- Historical buyer recovery continues to treat payments.initiated_by_user_id
-- as the immutable raw Auth audit principal. A linked provider is equivalent
-- only when this private SocialBid mapping resolves it to the requesting
-- canonical account.
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
     or v_claim.attempt_count >= 10 then
    return null;
  end if;

  update public.social_bid_buyer_recovery_requests
    set attempt_count = attempt_count + 1
    where id = v_claim.id;

  if not exists (
    select 1
    from public.payments p
    join public.ownerships o
      on o.payment_id = p.id and o.buyer_id = p.buyer_id
    where p.buyer_id = v_claim.buyer_id and p.status = 'applied'
  ) then
    return null;
  end if;

  select user_id into v_owner
  from public.buyers
  where id = v_claim.buyer_id
  for update;

  if exists (
    select 1
    from public.payments p
    where p.buyer_id = v_claim.buyer_id
      and p.status = 'applied'
      and p.initiated_by_user_id is not null
      and coalesce(
        (
          select mapping.canonical_user_id
          from public.social_bid_account_auth_users mapping
          where mapping.auth_user_id = p.initiated_by_user_id
        ),
        p.initiated_by_user_id
      ) <> p_user_id
  ) then
    return null;
  end if;

  update public.buyers
    set user_id = p_user_id
    where id = v_claim.buyer_id;

  if not found then
    return null;
  end if;

  update public.social_bid_buyer_recovery_requests
    set consumed_at = now(),
        previous_user_id = v_owner,
        ownership_reassigned_at = case
          when v_owner is distinct from p_user_id then now()
          else ownership_reassigned_at
        end
    where id = v_claim.id;

  return v_claim.buyer_id;
end;
$$;

revoke execute on function public.claim_social_bid_historical_buyer(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_social_bid_historical_buyer(text, uuid)
  to service_role;
