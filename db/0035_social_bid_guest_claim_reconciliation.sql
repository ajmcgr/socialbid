-- SOCIAL BID ONLY — reconcile a securely claimed temporary guest buyer into
-- the same canonical account's existing commercial buyer identity.

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
  v_guest_buyer public.buyers%rowtype;
  v_existing_buyer_id uuid;
  v_source_conversation public.social_bid_conversations%rowtype;
  v_target_conversation public.social_bid_conversations%rowtype;
  v_unlock_payment_id uuid;
  v_latest_payment_id uuid;
begin
  if p_user_id is null then
    return null;
  end if;

  -- The capability row is the concurrency lock. A second/replayed claim waits
  -- for this transaction and then observes consumed_at.
  select * into v_claim
  from public.social_bid_guest_buyer_claims
  where token_hash = p_token_hash
  for update;

  if not found
     or v_claim.consumed_at is not null
     or v_claim.expires_at <= now() then
    return null;
  end if;

  -- A valid capability alone is insufficient: the exact payment must have
  -- produced its matching applied ownership for this same temporary buyer.
  if not exists (
    select 1
    from public.payments p
    join public.ownerships o
      on o.payment_id = p.id
     and o.buyer_id = p.buyer_id
    where p.id = v_claim.payment_id
      and p.buyer_id = v_claim.buyer_id
      and p.status = 'applied'
  ) then
    return null;
  end if;

  select * into v_guest_buyer
  from public.buyers
  where id = v_claim.buyer_id
  for update;

  if not found then
    return null;
  end if;

  if v_guest_buyer.user_id is not null then
    if v_guest_buyer.user_id <> p_user_id then
      return null;
    end if;

    update public.social_bid_guest_buyer_claims
    set consumed_at = now(),
        claimed_by_user_id = p_user_id
    where id = v_claim.id;
    return v_guest_buyer.id;
  end if;

  -- Identity equality intentionally matches the unique-index semantics used
  -- by checkout. Similar names or emails are never sufficient on their own;
  -- this branch is reachable only after the secure claim was validated above.
  select b.id into v_existing_buyer_id
  from public.buyers b
  where b.user_id = p_user_id
    and lower(btrim(b.email)) = lower(btrim(v_guest_buyer.email))
    and lower(btrim(coalesce(b.company_name, ''))) =
        lower(btrim(coalesce(v_guest_buyer.company_name, '')))
  order by b.id
  limit 1
  for update;

  if v_existing_buyer_id is null then
    update public.buyers
    set user_id = p_user_id
    where id = v_guest_buyer.id
      and user_id is null;

    if not found then
      raise exception 'Social Bid guest buyer changed during claim';
    end if;

    update public.social_bid_guest_buyer_claims
    set consumed_at = now(),
        claimed_by_user_id = p_user_id
    where id = v_claim.id;
    return v_guest_buyer.id;
  end if;

  -- Merge each temporary conversation into the canonical buyer's existing
  -- creator relationship when one exists. Otherwise transfer it intact.
  for v_source_conversation in
    select c.*
    from public.social_bid_conversations c
    where c.buyer_id = v_guest_buyer.id
    order by c.id
    for update
  loop
    select c.* into v_target_conversation
    from public.social_bid_conversations c
    where c.creator_id = v_source_conversation.creator_id
      and c.buyer_id = v_existing_buyer_id
    for update;

    if not found then
      update public.social_bid_conversations
      set buyer_id = v_existing_buyer_id
      where id = v_source_conversation.id;
      continue;
    end if;

    select candidate.payment_id into v_unlock_payment_id
    from (values
      (v_target_conversation.unlocked_by_payment_id),
      (v_source_conversation.unlocked_by_payment_id)
    ) as candidate(payment_id)
    join public.payments p on p.id = candidate.payment_id
    order by p.created_at asc, p.id asc
    limit 1;

    select candidate.payment_id into v_latest_payment_id
    from (values
      (v_target_conversation.latest_sponsorship_payment_id),
      (v_source_conversation.latest_sponsorship_payment_id)
    ) as candidate(payment_id)
    join public.payments p on p.id = candidate.payment_id
    order by p.created_at desc, p.id desc
    limit 1;

    -- Repoint every conversation dependency before deleting the duplicate.
    update public.social_bid_message_attachments
    set conversation_id = v_target_conversation.id
    where conversation_id = v_source_conversation.id;

    update public.social_bid_messages
    set conversation_id = v_target_conversation.id
    where conversation_id = v_source_conversation.id;

    update public.social_bid_notifications
    set conversation_id = v_target_conversation.id
    where conversation_id = v_source_conversation.id;

    update public.social_bid_conversation_reports
    set conversation_id = v_target_conversation.id
    where conversation_id = v_source_conversation.id;

    update public.social_bid_conversations
    set unlocked_by_payment_id = v_unlock_payment_id,
        latest_sponsorship_payment_id = v_latest_payment_id,
        creator_last_read_at = case
          when v_target_conversation.creator_last_read_at is null
            or v_source_conversation.creator_last_read_at is null then null
          else least(
            v_target_conversation.creator_last_read_at,
            v_source_conversation.creator_last_read_at
          )
        end,
        sponsor_last_read_at = case
          when v_target_conversation.sponsor_last_read_at is null
            or v_source_conversation.sponsor_last_read_at is null then null
          else least(
            v_target_conversation.sponsor_last_read_at,
            v_source_conversation.sponsor_last_read_at
          )
        end,
        creator_marked_unread_at = greatest(
          v_target_conversation.creator_marked_unread_at,
          v_source_conversation.creator_marked_unread_at
        ),
        sponsor_marked_unread_at = greatest(
          v_target_conversation.sponsor_marked_unread_at,
          v_source_conversation.sponsor_marked_unread_at
        ),
        blocked_by_creator_at = case
          when v_target_conversation.blocked_by_creator_at is null then
            v_source_conversation.blocked_by_creator_at
          when v_source_conversation.blocked_by_creator_at is null then
            v_target_conversation.blocked_by_creator_at
          else least(
            v_target_conversation.blocked_by_creator_at,
            v_source_conversation.blocked_by_creator_at
          )
        end,
        blocked_by_sponsor_at = case
          when v_target_conversation.blocked_by_sponsor_at is null then
            v_source_conversation.blocked_by_sponsor_at
          when v_source_conversation.blocked_by_sponsor_at is null then
            v_target_conversation.blocked_by_sponsor_at
          else least(
            v_target_conversation.blocked_by_sponsor_at,
            v_source_conversation.blocked_by_sponsor_at
          )
        end,
        created_at = least(
          v_target_conversation.created_at,
          v_source_conversation.created_at
        ),
        updated_at = greatest(
          v_target_conversation.updated_at,
          v_source_conversation.updated_at
        )
    where id = v_target_conversation.id;

    delete from public.social_bid_conversations
    where id = v_source_conversation.id;
  end loop;

  -- Preserve all financial, sponsorship, notification and recovery history by
  -- repointing every live buyer foreign key before removing the empty alias.
  update public.payments
  set buyer_id = v_existing_buyer_id
  where buyer_id = v_guest_buyer.id;

  update public.ownerships
  set buyer_id = v_existing_buyer_id
  where buyer_id = v_guest_buyer.id;

  update public.social_bid_notifications
  set buyer_id = v_existing_buyer_id
  where buyer_id = v_guest_buyer.id;

  update public.social_bid_buyer_recovery_requests
  set buyer_id = v_existing_buyer_id
  where buyer_id = v_guest_buyer.id;

  update public.social_bid_guest_buyer_claims
  set buyer_id = v_existing_buyer_id
  where buyer_id = v_guest_buyer.id;

  delete from public.buyers
  where id = v_guest_buyer.id
    and user_id is null;

  if not found then
    raise exception 'Social Bid guest buyer could not be reconciled';
  end if;

  update public.social_bid_guest_buyer_claims
  set consumed_at = now(),
      claimed_by_user_id = p_user_id
  where id = v_claim.id;

  return v_existing_buyer_id;
end;
$$;

revoke all on function public.claim_social_bid_guest_buyer(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_social_bid_guest_buyer(text, uuid)
  to service_role;

comment on function public.claim_social_bid_guest_buyer(text, uuid) is
  'Social Bid service-role-only guest claim with atomic exact-identity buyer and conversation reconciliation.';
