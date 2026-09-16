-- SOCIAL BID ONLY — allow a canonical account to recover a historical buyer
-- identity that was incorrectly linked before payment principals were recorded.
-- The existing verified-email capability remains mandatory. Modern ownership
-- with a conflicting immutable payment principal can never be transferred.

alter table public.social_bid_buyer_recovery_requests
  add column if not exists previous_user_id uuid references auth.users(id) on delete set null,
  add column if not exists ownership_reassigned_at timestamptz;

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

  -- An immutable modern checkout principal is authoritative. Recovery may
  -- consolidate records already proven to this user, but must never take a
  -- buyer that a successful payment proves belongs to somebody else.
  if exists (
    select 1
    from public.payments p
    where p.buyer_id = v_claim.buyer_id
      and p.status = 'applied'
      and p.initiated_by_user_id is not null
      and p.initiated_by_user_id <> p_user_id
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
