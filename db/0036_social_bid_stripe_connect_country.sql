-- SocialBid only: explicit Stripe Connect country selection and safe restart
-- for unused, incomplete Express accounts. Additive/idempotent and isolated
-- from Post's payment, Stripe, and user tables.

alter table public.creators
  add column if not exists stripe_connect_generation integer not null default 0
    check (stripe_connect_generation >= 0),
  add column if not exists stripe_reset_in_progress boolean not null default false;

create table if not exists public.social_bid_stripe_connect_account_resets (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creators(id) on delete restrict,
  old_stripe_account_id text not null,
  new_stripe_account_id text,
  reason text not null default 'creator_reset'
    check (reason = 'creator_reset'),
  status text not null
    check (status in ('in_progress', 'completed', 'failed')),
  stripe_deletion_succeeded boolean not null default false,
  failure_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists social_bid_stripe_connect_resets_active_creator_key
  on public.social_bid_stripe_connect_account_resets (creator_id)
  where status = 'in_progress';

create index if not exists social_bid_stripe_connect_resets_creator_idx
  on public.social_bid_stripe_connect_account_resets (creator_id);

create unique index if not exists social_bid_stripe_connect_resets_completed_account_key
  on public.social_bid_stripe_connect_account_resets (old_stripe_account_id)
  where status = 'completed';

alter table public.social_bid_stripe_connect_account_resets enable row level security;
revoke all on table public.social_bid_stripe_connect_account_resets from public, anon, authenticated;
grant all on table public.social_bid_stripe_connect_account_resets to service_role;

create or replace function public.inspect_social_bid_stripe_connect_reset(
  p_creator_id uuid,
  p_stripe_account_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator public.creators%rowtype;
begin
  select * into creator
  from public.creators
  where id = p_creator_id;

  if not found or creator.stripe_account_id is distinct from p_stripe_account_id then
    return jsonb_build_object('eligible', false, 'reason', 'account_changed');
  end if;

  if creator.stripe_reset_in_progress then
    return jsonb_build_object('eligible', false, 'reason', 'reset_in_progress');
  end if;

  -- Pending held earnings survive a safe account restart because they belong to
  -- the creator, not an account id. Any attempted/completed Stripe transfer
  -- makes the old account immutable for automated restart.
  if exists (
    select 1
    from public.payouts payout
    where payout.creator_id = p_creator_id
      and (
        payout.stripe_transfer_id is not null
        or payout.released_at is not null
        or payout.status = 'paid'
        or payout.attempts > 0
      )
  ) then
    return jsonb_build_object('eligible', false, 'reason', 'financial_history');
  end if;

  return jsonb_build_object('eligible', true, 'reason', null);
end;
$$;

create or replace function public.claim_social_bid_stripe_connect_reset(
  p_creator_id uuid,
  p_stripe_account_id text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator public.creators%rowtype;
  eligibility jsonb;
  reset_row public.social_bid_stripe_connect_account_resets%rowtype;
begin
  select * into creator
  from public.creators
  where id = p_creator_id
  for update;

  if not found or creator.stripe_account_id is distinct from p_stripe_account_id then
    return jsonb_build_object('claimed', false, 'reason', 'account_changed');
  end if;

  if creator.stripe_reset_in_progress then
    select * into reset_row
    from public.social_bid_stripe_connect_account_resets
    where creator_id = p_creator_id and status = 'in_progress'
    order by requested_at desc
    limit 1;
    return jsonb_build_object(
      'claimed', false,
      'reason', 'reset_in_progress',
      'resetId', reset_row.id,
      'recoverable', reset_row.requested_at < now() - interval '2 minutes'
    );
  end if;

  -- Serialize against payout release attempts for this creator. A release that
  -- already incremented attempts makes the reset ineligible; a later release
  -- waits, then observes stripe_reset_in_progress and cannot transfer.
  perform 1
  from public.payouts
  where creator_id = p_creator_id
  for update;

  eligibility := public.inspect_social_bid_stripe_connect_reset(
    p_creator_id,
    p_stripe_account_id
  );
  if not coalesce((eligibility ->> 'eligible')::boolean, false) then
    return jsonb_build_object(
      'claimed', false,
      'reason', coalesce(eligibility ->> 'reason', 'financial_history')
    );
  end if;

  update public.creators
  set stripe_reset_in_progress = true
  where id = p_creator_id and stripe_account_id = p_stripe_account_id;

  insert into public.social_bid_stripe_connect_account_resets (
    creator_id,
    old_stripe_account_id,
    status
  ) values (
    p_creator_id,
    p_stripe_account_id,
    'in_progress'
  ) returning * into reset_row;

  return jsonb_build_object('claimed', true, 'reason', null, 'resetId', reset_row.id);
end;
$$;

create or replace function public.complete_social_bid_stripe_connect_reset(
  p_creator_id uuid,
  p_stripe_account_id text,
  p_reset_id uuid
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  perform 1
  from public.social_bid_stripe_connect_account_resets
  where id = p_reset_id
    and creator_id = p_creator_id
    and old_stripe_account_id = p_stripe_account_id
    and status = 'in_progress'
  for update;
  if not found then
    return false;
  end if;

  update public.creators
  set stripe_account_id = null,
      stripe_payouts_enabled = false,
      stripe_details_submitted = false,
      stripe_onboarded_at = null,
      stripe_connect_generation = stripe_connect_generation + 1,
      stripe_reset_in_progress = false
  where id = p_creator_id
    and stripe_account_id = p_stripe_account_id
    and stripe_reset_in_progress = true;
  get diagnostics changed_count = row_count;

  if changed_count <> 1 then
    return false;
  end if;

  update public.social_bid_stripe_connect_account_resets
  set status = 'completed',
      stripe_deletion_succeeded = true,
      failure_code = null,
      completed_at = now()
  where id = p_reset_id
    and creator_id = p_creator_id
    and old_stripe_account_id = p_stripe_account_id
    and status = 'in_progress';

  return true;
end;
$$;

create or replace function public.release_social_bid_stripe_connect_reset(
  p_creator_id uuid,
  p_stripe_account_id text,
  p_reset_id uuid,
  p_failure_code text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.creators
  set stripe_reset_in_progress = false
  where id = p_creator_id
    and stripe_account_id = p_stripe_account_id
    and stripe_reset_in_progress = true;

  update public.social_bid_stripe_connect_account_resets
  set status = 'failed',
      stripe_deletion_succeeded = false,
      failure_code = left(coalesce(p_failure_code, 'stripe_delete_failed'), 80),
      completed_at = now()
  where id = p_reset_id
    and creator_id = p_creator_id
    and old_stripe_account_id = p_stripe_account_id
    and status = 'in_progress';

  return found;
end;
$$;

create or replace function public.record_social_bid_stripe_connect_replacement(
  p_creator_id uuid,
  p_new_stripe_account_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.social_bid_stripe_connect_account_resets
  set new_stripe_account_id = p_new_stripe_account_id
  where id = (
    select id
    from public.social_bid_stripe_connect_account_resets
    where creator_id = p_creator_id
      and status = 'completed'
      and new_stripe_account_id is null
    order by completed_at desc
    limit 1
  );
end;
$$;

revoke all on function public.inspect_social_bid_stripe_connect_reset(uuid, text)
  from public, anon, authenticated;
revoke all on function public.claim_social_bid_stripe_connect_reset(uuid, text)
  from public, anon, authenticated;
revoke all on function public.complete_social_bid_stripe_connect_reset(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.release_social_bid_stripe_connect_reset(uuid, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.record_social_bid_stripe_connect_replacement(uuid, text)
  from public, anon, authenticated;

grant execute on function public.inspect_social_bid_stripe_connect_reset(uuid, text)
  to service_role;
grant execute on function public.claim_social_bid_stripe_connect_reset(uuid, text)
  to service_role;
grant execute on function public.complete_social_bid_stripe_connect_reset(uuid, text, uuid)
  to service_role;
grant execute on function public.release_social_bid_stripe_connect_reset(uuid, text, uuid, text)
  to service_role;
grant execute on function public.record_social_bid_stripe_connect_replacement(uuid, text)
  to service_role;
