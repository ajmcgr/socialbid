-- SOCIALBID ONLY — one-time, mailbox-proven email sign-in linking for an
-- already authenticated canonical SocialBid account. This does not alter the
-- shared project's provider settings or any Post table/function.

create table if not exists public.social_bid_email_identity_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  email_hash text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (email_hash ~ '^[0-9a-f]{64}$'),
  check (token_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists social_bid_email_identity_links_user_created_idx
  on public.social_bid_email_identity_links (user_id, created_at desc);

alter table public.social_bid_email_identity_links enable row level security;
revoke all privileges on table public.social_bid_email_identity_links
  from public, anon, authenticated;
grant all privileges on table public.social_bid_email_identity_links to service_role;

create or replace function public.reserve_social_bid_email_identity_link(
  p_user_id uuid,
  p_email text,
  p_email_hash text,
  p_token_hash text
) returns text
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id)
     or v_email is null
     or v_email = ''
     or v_email like '%.invalid'
     or p_email_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  -- A verified credential already belonging to another canonical user is a
  -- hard conflict. Never merge or transfer ownership based on an email match.
  if exists (
    select 1
    from auth.users
    where lower(email) = v_email
      and id <> p_user_id
  ) then
    return 'conflict';
  end if;

  update public.social_bid_email_identity_links
  set used_at = coalesce(used_at, now())
  where user_id = p_user_id and used_at is null;

  insert into public.social_bid_email_identity_links (
    user_id, email, email_hash, token_hash, expires_at
  ) values (
    p_user_id, v_email, p_email_hash, p_token_hash, now() + interval '30 minutes'
  );

  return 'reserved';
end;
$$;

revoke all on function public.reserve_social_bid_email_identity_link(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_social_bid_email_identity_link(uuid, text, text, text)
  to service_role;
