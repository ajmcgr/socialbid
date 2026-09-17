-- SOCIAL BID ONLY — durable rate limiting for SocialBid's Resend-delivered
-- Supabase Auth magic links. No Post tables, functions, or auth settings change.

create table if not exists public.social_bid_auth_email_requests (
  email_hash text primary key,
  last_requested_at timestamptz not null default now(),
  request_count integer not null default 1 check (request_count > 0),
  created_at timestamptz not null default now(),
  check (email_hash ~ '^[0-9a-f]{64}$')
);

alter table public.social_bid_auth_email_requests enable row level security;
revoke all privileges on table public.social_bid_auth_email_requests
  from public, anon, authenticated;
grant all privileges on table public.social_bid_auth_email_requests to service_role;

create or replace function public.reserve_social_bid_auth_email(p_email_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rows integer;
begin
  if p_email_hash is null or p_email_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  insert into public.social_bid_auth_email_requests as requests (
    email_hash,
    last_requested_at,
    request_count
  ) values (
    p_email_hash,
    now(),
    1
  )
  on conflict (email_hash) do update
    set last_requested_at = now(),
        request_count = requests.request_count + 1
    where requests.last_requested_at <= now() - interval '60 seconds';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.reserve_social_bid_auth_email(text)
  from public, anon, authenticated;
grant execute on function public.reserve_social_bid_auth_email(text) to service_role;
